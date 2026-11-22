importScripts("shared.js");

// Service worker: único ponto que fala com o CRM.
// Roda no contexto da extensão (com host_permissions), então NÃO está sujeito
// ao CORS da página web.whatsapp.com — por isso todas as fetches saem daqui.

const FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_BASE_URL = "https://app.adragencia.com.br";
const TRANSCRIPT_CACHE_KEY_PREFIX = "transcriptCacheV2:";
const U = globalThis.CRMWAUtils;
const activeLookupControllers = new Map();
const lookupCache = new Map();
const LOOKUP_CACHE_TTL_MS = 60_000;

async function shortTokenFingerprint(token) {
  const bytes = new TextEncoder().encode(String(token || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function transcriptCacheKey(scope) {
  const normalized = String(scope || "").trim();
  if (!normalized || normalized.length > 200) throw new ApiRequestError("Contexto de sessão inválido.", 400, "INVALID_SESSION_SCOPE");
  return `${TRANSCRIPT_CACHE_KEY_PREFIX}${normalized}`;
}

async function readTranscriptCache(scope) {
  const key = transcriptCacheKey(scope);
  const stored = await chrome.storage.session.get(key);
  const items = U.normalizeTranscriptCache(stored[key]);
  await chrome.storage.session.set({ [key]: items });
  return items;
}

let transcriptCacheWriteQueue = Promise.resolve();
async function storeTranscriptCache(scope, externalId, text) {
  const key = transcriptCacheKey(scope);
  const write = transcriptCacheWriteQueue.then(async () => {
    const current = await readTranscriptCache(scope);
    const items = U.upsertTranscriptCache(current, externalId, text);
    await chrome.storage.session.set({ [key]: items });
    return items;
  });
  transcriptCacheWriteQueue = write.catch(() => undefined);
  return write;
}

// Auth por sessão: lê o cookie auth_token do CRM (de quem já está logado no navegador).
// A API aceita esse JWT como Bearer (lib/auth.ts). Nenhuma credencial fica no pacote/storage.
async function getCookieValue(baseUrl, name) {
  try {
    const c = await chrome.cookies.get({ url: baseUrl, name });
    return c?.value || "";
  } catch {
    return "";
  }
}

async function getConfig() {
  const [stored, managed] = await Promise.all([
    chrome.storage.local.get(["baseUrl", "tenantId", "token"]),
    chrome.storage.managed.get(["baseUrl", "tenantId"]).catch(() => ({})),
  ]);
  if (stored.token) await chrome.storage.local.remove("token");
  const requestedBaseUrl = managed.baseUrl || stored.baseUrl || DEFAULT_BASE_URL;
  const baseUrl = normalizeAllowedBaseUrl(requestedBaseUrl);
  const [personalToken, activeTenantId, impersonationSession] = await Promise.all([
    getCookieValue(baseUrl, "auth_token"),
    getCookieValue(baseUrl, "tenant_id"),
    getCookieValue(baseUrl, "adr_impersonation_session"),
  ]);
  const tenantId = String(managed.tenantId || activeTenantId || stored.tenantId || "").trim();
  return { baseUrl, tenantId, personalToken, impersonationSession };
}

function normalizeAllowedBaseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const allowed = new Set([DEFAULT_BASE_URL, "http://localhost:3000"]);
    return allowed.has(url.origin) && (url.pathname === "/" || url.pathname === "")
      ? url.origin
      : DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

chrome.runtime.onInstalled.addListener(() =>
  chrome.storage.local.remove(["token", "autoIncoming", "autoSendByChat", "autoTranscribe"])
);

class ApiRequestError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code || (status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : "API_ERROR");
  }
}

// translatedText: null = já está no idioma (o envio automático manda o original).
// Campo AUSENTE é resposta quebrada: como null, o português saía numa conversa
// com tradução automática. Mesma regra do app desktop (translateForWorkspace).
function translationResult(data) {
  if (!data || typeof data !== "object" || !("translatedText" in data)) {
    throw new ApiRequestError("Resposta de tradução inválida. Tente novamente.", 502, "UPSTREAM_ERROR");
  }
  return { translatedText: data.translatedText || null, sourceLanguage: data.sourceLanguage };
}


async function timedFetch(url, init, timeoutMs = FETCH_TIMEOUT_MS, externalSignal = null) {
  const ctrl = new AbortController();
  let timedOut = false;
  const abortFromExternal = () => ctrl.abort();
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e?.name === "AbortError") {
      if (!timedOut && externalSignal?.aborted) {
        throw new ApiRequestError("Consulta anterior cancelada.", 499, "REQUEST_ABORTED");
      }
      throw new ApiRequestError("Tempo esgotado ao falar com o CRM.", 504, "TIMEOUT");
    }
    throw new ApiRequestError("Falha de rede ao falar com o CRM. Verifique a URL nas opções.", 503, "NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

// Endpoints do CRM (busca, respostas, transcrição por mensagem): exigem identidade pessoal.
function personalHeaders(cfg, extra) {
  if (cfg.impersonationSession) {
    const err = new Error("A extensão fica bloqueada durante o acesso como outro usuário. Encerre a impersonação para continuar.");
    err.code = "IMPERSONATION_UNSUPPORTED";
    throw err;
  }
  if (!cfg.personalToken) {
    const err = new Error("Faça login no CRM (app.adragencia.com.br) para usar este recurso.");
    err.code = "NOT_CONFIGURED";
    throw err;
  }
  const headers = { Authorization: `Bearer ${cfg.personalToken}`, ...extra };
  if (cfg.tenantId) headers["x-tenant-id"] = cfg.tenantId;
  return headers;
}

function utilityHeaders(cfg, extra) {
  return personalHeaders(cfg, extra);
}

async function readResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(data?.error || `Erro ${res.status}`, res.status, data?.code);
  }
  return data;
}

async function apiWithConfig(cfg, path, signal = null) {
  const res = await timedFetch(`${cfg.baseUrl}${path}`, { headers: personalHeaders(cfg) }, FETCH_TIMEOUT_MS, signal);
  return readResponse(res);
}

async function api(path) {
  return apiWithConfig(await getConfig(), path);
}

async function apiPost(path, body, timeoutMs) {
  const cfg = await getConfig();
  const res = await timedFetch(
    `${cfg.baseUrl}${path}`,
    {
      method: "POST",
      headers: personalHeaders(cfg, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    },
    timeoutMs
  );
  return readResponse(res);
}

// POST utilitário (tradução de texto) autenticado pela sessão pessoal do CRM.
async function apiPostUtility(path, body) {
  const cfg = await getConfig();
  const res = await timedFetch(
    `${cfg.baseUrl}${path}`,
    {
      method: "POST",
      headers: utilityHeaders(cfg, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    },
    75_000
  );
  return readResponse(res);
}

const handlers = {
  async gmailOpenCrm() {
    const cfg = await getConfig();
    await chrome.tabs.create({ url: cfg.baseUrl });
    return {};
  },
  async gmailLookup({ email }) {
    const address = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) {
      throw new ApiRequestError("Informe um e-mail válido.", 400, "INVALID_EMAIL");
    }
    const result = await api(`/api/crm/contacts?email=${encodeURIComponent(address)}&limit=8`);
    const contacts = (result?.items || []).filter((contact) => String(contact.email || "").toLowerCase() === address).slice(0, 5);
    const dealsById = new Map();
    let dealsUnavailable = false;
    // Em paralelo (o desktop faz igual): em série eram três idas e voltas antes
    // de o painel mostrar qualquer coisa. A ordem segue a dos contatos.
    const results = await Promise.allSettled(
      contacts
        .slice(0, 3)
        .map((contact) => api(`/api/crm/deals?contactId=${encodeURIComponent(contact.id)}&pageSize=10`)),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const deal of result.value?.items || []) dealsById.set(deal.id, deal);
      } else if (result.reason?.status === 403) {
        dealsUnavailable = true;
      } else {
        throw result.reason;
      }
    }
    return {
      contacts: contacts.map((contact) => ({ id: contact.id, name: contact.name, email: contact.email, company: contact.company?.name || null })),
      deals: [...dealsById.values()].slice(0, 10).map((deal) => ({ id: deal.id, number: deal.number, title: deal.title, status: deal.status })),
      dealsUnavailable,
    };
  },

  async gmailAssist({ mode, language, instructions, text, subject, tone }) {
    const data = await apiPostUtility("/api/gmail/assistant", { mode, language, instructions, text, subject, tone });
    // Mesma normalização do Workspace (gmail-commands.ts): sem corpo, o painel
    // mostrava "Prévia pronta" com a caixa vazia.
    const body = typeof data?.body === "string" ? data.body.trim() : "";
    if (!body) throw new ApiRequestError("O assistente não devolveu um texto. Tente novamente.", 502, "EMPTY_ASSISTANT_BODY");
    const result = { body };
    if (typeof data?.subject === "string" && data.subject.trim()) result.subject = data.subject.trim();
    return result;
  },

  // E-mail recebido → português, pelo mesmo serviço de tradução do WhatsApp.
  async gmailTranslate({ text }) {
    const value = String(text || "").trim();
    if (!value || value.length > 6000) {
      throw new ApiRequestError("Texto do e-mail inválido.", 400, "INVALID_REQUEST");
    }
    const data = await apiPostUtility("/api/whatsapp/app/translate-text", {
      text: value,
      targetLanguage: "pt-BR",
    });
    return translationResult(data);
  },

  async getTranscriptCache({ scope }) {
    return { items: await readTranscriptCache(scope) };
  },

  async cacheTranscript({ scope, externalId, text }) {
    const items = await storeTranscriptCache(scope, externalId, text);
    return { saved: Object.hasOwn(items, String(externalId || "").trim()) };
  },

  async getChatIdentity(_message, { sender }) {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId)) throw new ApiRequestError("Aba do WhatsApp indisponível.", 400, "INVALID_SENDER");
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [sender.frameId || 0] },
      world: "MAIN",
      func: () => {
        const header = document.querySelector("#main header");
        if (!header) return null;
        const fiberOf = (element) => {
          for (const key in element) {
            if (key.startsWith("__reactFiber$") || key.startsWith("__reactProps$")) return element[key];
          }
          return null;
        };
        const serialized = (value) => {
          if (value == null) return "";
          if (typeof value === "object") return value._serialized || "";
          return String(value);
        };
        let fiber = fiberOf(header);
        for (let hops = 0; fiber && hops < 60; hops += 1, fiber = fiber.return) {
          const props = fiber.memoizedProps || fiber.pendingProps || {};
          const chat = props.chat;
          if (!chat) continue;
          const id = serialized(chat.id);
          const candidate = serialized(chat.contact?.phoneNumber) || id;
          const digits = /@c\.us$/.test(candidate) ? candidate.replace(/@.*/, "").replace(/\D/g, "") : "";
          return {
            id: id || null,
            phone: digits.length >= 8 && digits.length <= 15 ? digits : null,
            isGroup: /@g\.us$/.test(id),
          };
        }
        return null;
      },
    });
    return { chat: results?.[0]?.result || null };
  },

  async lookup({ phone, name, scope }, { sender }) {
    const lookupKey = `${sender.tab?.id ?? "extension"}:${sender.frameId ?? 0}`;
    activeLookupControllers.get(lookupKey)?.abort();
    const controller = new AbortController();
    activeLookupControllers.set(lookupKey, controller);
    const cfg = await getConfig();
    personalHeaders(cfg);
    const tokenFingerprint = await shortTokenFingerprint(cfg.personalToken);
    const cacheKey = `${cfg.baseUrl}|${cfg.tenantId}|${tokenFingerprint}|${String(scope || "")}|${phone || ""}|${name || ""}`;
    const cached = lookupCache.get(cacheKey);
    if (cached && Date.now() - cached.at < LOOKUP_CACHE_TTL_MS) {
      if (activeLookupControllers.get(lookupKey) === controller) activeLookupControllers.delete(lookupKey);
      return cached.value;
    }
    const request = (path) => apiWithConfig(cfg, path, controller.signal);
    try {
    // 1) Acha o CONTATO (por número, ou por nome completo + partes). A busca por texto serve
    //    só pra achar a pessoa — NÃO pra achar negócios (senão "Carol" traz negócios de
    //    qualquer Carol). Ex.: "Isabela Curty | Duty Cosméticos" → tenta as partes também.
    const contactsById = new Map();
    if (phone) {
      const data = await request(`/api/crm/contacts?phone=${encodeURIComponent(phone)}&limit=5`);
      (data?.items || []).forEach((c) => contactsById.set(c.id, c));
    } else {
      const terms = [
        ...new Set(
          [String(name || "").trim(), ...String(name || "").split(/[|\-–—•·/]+/).map((s) => s.trim())].filter(
            (t) => t.length >= 3
          )
        ),
      ].slice(0, 4);
      // limit alto: há muitos homônimos ("Carol" tem 39 contatos). Precisa trazer o certo
      // no conjunto pra a desambiguação por empresa achá-lo.
      await Promise.all(
        terms.map((t) =>
          request(`/api/crm/contacts?search=${encodeURIComponent(t)}&limit=25`).then((d) =>
            (d?.items || []).forEach((c) => contactsById.set(c.id, c))
          )
        )
      );
    }
    const found = [...contactsById.values()];

    // 1b) DESAMBIGUAÇÃO (busca por nome acha vários: "Carol" casa com Carolina, Ana Carolina…).
    //     Fica só com quem casa DE VERDADE com o cabeçalho: nome exato da pessoa + empresa
    //     batendo. Só se houver match forte; senão mantém todos (fallback).
    let contacts = found;
    if (name && found.length > 1) {
      const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
      // Palavras genéricas de nome de empresa que NÃO servem pra casar (senão "Brasil"
      // ligaria empresas diferentes). O que casa é um token distintivo (a marca).
      const STOP = new Set(["brasil","brazil","brands","group","grupo","ltda","eireli","cosmeticos","cosmetics","company","oficial","store","comercio","industria","cn","the","and"]);
      const toks = (s) => norm(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STOP.has(t));
      const full = norm(name);
      const parts = String(name).split(/[|\-–—•·/]+/).map((s) => norm(s)).filter(Boolean);
      const person = parts[0] || full;
      const compToks = toks(parts[1] || "");
      const score = (c) => {
        const cn = norm(c.name);
        const coToks = toks(c.company && c.company.name);
        let s = 0;
        if (cn && cn === full) s += 100;
        else if (cn && cn === person) s += 40;
        else if (person && (cn.includes(person) || person.includes(cn))) s += 15;
        // Empresa por TOKEN distintivo compartilhado: sinal forte e à prova de sufixo.
        // "Jiaogepengyou CN"↔"Jiaogepengyou" e "Skelt Beauty"↔"Skelt Beauty Brands" casam.
        if (compToks.length && coToks.some((t) => compToks.includes(t))) s += 50;
        return s;
      };
      const scored = found.map((c) => ({ c, s: score(c) }));
      const max = Math.max(...scored.map((x) => x.s), 0);
      // Fica só com os de MAIOR score. A empresa (50) faz a pessoa certa ganhar de um
      // homônimo pelado ("Ana Paula Quo/Jiaogepengyou"=65 > "Ana Paula" sem empresa=40).
      // Empate real (mesmo nome, mesma empresa) mantém os empatados.
      if (max >= 40) contacts = scored.filter((x) => x.s === max).map((x) => x.c);
    }

    // 2) Negócios VINCULADOS ao contato/empresa (filtro estruturado, sem ruído de texto).
    //    Prioriza abertos (status=OPEN). Assim só aparecem negócios que realmente são dessa
    //    pessoa/empresa — não qualquer negócio que "casou" com o nome.
    const contactIds = contacts.map((c) => c.id).filter(Boolean).slice(0, 3);
    const companyIds = [...new Set(contacts.map((c) => c.company?.id).filter(Boolean))].slice(0, 2);
    const dealsById = new Map();
    const addDeals = (d) => (d?.items || []).forEach((x) => dealsById.set(x.id, x));
    const dealQueries = [];
    for (const cid of contactIds) {
      dealQueries.push(request(`/api/crm/deals?contactId=${cid}&status=OPEN&pageSize=10`).then(addDeals));
      dealQueries.push(request(`/api/crm/deals?contactId=${cid}&pageSize=10`).then(addDeals));
    }
    for (const compId of companyIds) {
      dealQueries.push(request(`/api/crm/deals?companyId=${compId}&status=OPEN&pageSize=10`).then(addDeals));
      dealQueries.push(request(`/api/crm/deals?companyId=${compId}&pageSize=10`).then(addDeals));
    }
    // 3) Projetos EM ABERTO da(s) empresa(s) — mesmo racional dos negócios: vínculo
    //    estruturado por empresa, sem ruído de texto. "Aberto" = não concluído/arquivado.
    //    Roda EM PARALELO com os negócios (ambos só dependem de companyIds) — não faz
    //    sentido esperar os negócios pra começar. Se Projetos nativos estiverem desligados
    //    ou o usuário não tiver permissão, a rota falha e o catch deixa a lista vazia.
    const projectsById = new Map();
    const warnings = new Set();
    const projectQueries = companyIds.map((compId) =>
      request(`/api/crm/companies/${encodeURIComponent(compId)}/projects`)
        .then((d) =>
          (d?.projects?.items || [])
            .filter((p) => p.status !== "completed" && p.status !== "archived")
            .forEach((p) => projectsById.set(p.id, p))
        )
        .catch((error) => {
          if (error?.status === 403 || error?.status === 404) {
            warnings.add("Projetos não estão disponíveis para este acesso.");
            return;
          }
          throw error;
        })
    );
    await Promise.all([...dealQueries, ...projectQueries]);

    const value = {
      deals: [...dealsById.values()].slice(0, 15).map((deal) => ({
        id: deal.id,
        number: deal.number,
        title: deal.title,
        status: deal.status,
        valueCents: deal.valueCents,
        currency: deal.currency,
        ownerDisplayName: deal.ownerDisplayName,
        stage: deal.stage ? { name: deal.stage.name } : null,
      })),
      contacts: contacts.slice(0, 8).map((contact) => ({
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        company: contact.company ? {
          id: contact.company.id,
          number: contact.company.number,
          name: contact.company.name,
        } : null,
      })),
      projects: [...projectsById.values()].slice(0, 15).map((project) => ({
        id: project.id,
        title: project.title,
        status: project.status,
      })),
      warnings: [...warnings],
    };
    lookupCache.set(cacheKey, { at: Date.now(), value });
    if (lookupCache.size > 200) lookupCache.delete(lookupCache.keys().next().value);
    return value;
    } finally {
      if (activeLookupControllers.get(lookupKey) === controller) activeLookupControllers.delete(lookupKey);
    }
  },

  async translate({ text, target }) {
    const data = await apiPostUtility("/api/whatsapp/app/translate-text", {
      text,
      targetLanguage: target,
    });
    return translationResult(data);
  },

  // Transcreve pela mensagem: o servidor rebaixa+descriptografa a mídia pela gateway
  // (Baileys) a partir do id do WhatsApp. Não precisamos extrair o áudio do DOM.
  async transcribeMessage({ externalId, remoteJid }) {
    // O pipeline do servidor é síncrono (resolver mídia + download + Groq) e pode
    // passar de 20s em áudio longo; abortar antes só troca resultado por "timeout".
    const data = await apiPost(
      `/api/whatsapp/app/messages/${encodeURIComponent(externalId)}/transcription`,
      { remoteJid: String(remoteJid || "") },
      180_000
    );
    return { status: data?.status || null, text: data?.text || null, error: data?.error || null };
  },

  // Valida a sessão de verdade; a mera presença de cookie não habilita o painel.
  async whoami() {
    try {
      const cfg = await getConfig();
      let userId = "";
      let tenantId = "";
      try {
        const data = await apiWithConfig(cfg, "/api/whatsapp/app/session");
        userId = String(data?.context?.userId || "").trim();
        tenantId = String(data?.context?.tenantId || "").trim();
      } catch (error) {
        // Compatibilidade durante rollout: a extensão pode atualizar antes do app.
        // /api/auth/me já existe nas versões anteriores e valida a mesma sessão pessoal.
        if (error?.status !== 404) throw error;
        const data = await apiWithConfig(cfg, "/api/auth/me");
        userId = String(data?.user?.id || "").trim();
        tenantId = String(data?.user?.tenant?.id || cfg.tenantId || "").trim();
      }
      return { hasCrm: !!userId && !!tenantId, scope: userId && tenantId ? `${tenantId}:${userId}` : "" };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403 || error?.code === "NOT_CONFIGURED") {
        return { hasCrm: false };
      }
      throw error;
    }
  },

  async quickReplies() {
    const data = await api("/api/whatsapp/app/quick-replies");
    const byId = new Map();
    for (const t of [...(data?.defaultTemplates || []), ...(data?.templates || [])]) {
      if (t && t.id) byId.set(t.id, t);
    }
    return { templates: [...byId.values()] };
  },

  // Testa a sessão sem depender do Groq.
  async ping() {
    const { baseUrl } = await getConfig();
    await api("/api/crm/contacts?limit=1");
    return { message: `Conectado: ${baseUrl}` };
  },

  async openOptions() {
    await chrome.runtime.openOptionsPage();
    return {};
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  const extensionOrigin = `chrome-extension://${chrome.runtime.id}/`;
  const isExtensionPage = String(sender.url || "").startsWith(extensionOrigin);
  const isWhatsAppContent =
    sender.id === chrome.runtime.id &&
    sender.frameId === 0 &&
    String(sender.tab?.url || sender.url || "").startsWith("https://web.whatsapp.com/");
  const isGmailContent =
    sender.id === chrome.runtime.id && sender.frameId === 0 &&
    String(sender.tab?.url || sender.url || "").startsWith("https://mail.google.com/mail/");
  const allowed = ["ping", "openOptions"].includes(msg.type) ? isExtensionPage
    : ["gmailLookup", "gmailAssist", "gmailTranslate", "gmailOpenCrm"].includes(msg.type)
      ? isGmailContent
      : isWhatsAppContent;
  if (!allowed) {
    sendResponse({ ok: false, error: "Origem da solicitação inválida.", code: "INVALID_SENDER", status: 403 });
    return false;
  }
  handler(msg, { sender })
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) =>
      sendResponse({ ok: false, error: String(err?.message || err), code: err?.code, status: err?.status })
    );
  return true; // resposta assíncrona
});
