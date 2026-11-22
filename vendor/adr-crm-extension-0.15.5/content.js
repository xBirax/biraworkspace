// Injetado em web.whatsapp.com. Usa CRMWADom (seletores) e fala com o CRM só via
// background (service worker), nunca fetch direto — evita o bloqueio de CORS.

const D = window.CRMWADom;
const U = window.CRMWAUtils;

// O service worker executa o leitor no MAIN world pelo canal interno do Chrome.
// A página hospedeira não participa do transporte da identidade.
async function getChatIdentity() {
  const result = await send("getChatIdentity");
  return result?.chat || null;
}

const ZOMBIE_CONTEXT_MSG = "A extensão foi atualizada. Recarregue a página (F5) e tente de novo.";

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    // Extensão recarregada/atualizada com a aba aberta: aviso claro em TODOS os
    // fluxos (traduzir, transcrever, painel), não só no auto-envio.
    if (!chrome.runtime?.id) return reject(new Error(ZOMBIE_CONTEXT_MSG));
    chrome.runtime.sendMessage({ type, ...payload }, (res) => {
      if (chrome.runtime.lastError) {
        const raw = chrome.runtime.lastError.message || "";
        return reject(new Error(/context invalidated/i.test(raw) ? ZOMBIE_CONTEXT_MSG : raw));
      }
      if (!res) return reject(new Error("Sem resposta do background."));
      if (!res.ok) return reject(Object.assign(new Error(res.error), { code: res.code, status: res.status }));
      resolve(res.data);
    });
  });
}

// Escapa texto antes de ir para innerHTML (nomes/empresas podem ter < > & etc).
function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

let baseUrl = "";
let hasCrm = false; // tem identidade CRM pessoal (login próprio)? controla o painel do CRM.
let crmAuthState = "loading";
let autoTranscribe = false; // preferência escopada por usuário/tenant; só áudios recentes
// Auto-traduzir ao enviar, por CONVERSA e escopado por usuário/tenant (como autoTranscribe):
// { [scope]: { [chatKey]: "en"|"es" } }. `autoSendLang` é o idioma da conversa ATUAL.
let autoSendByChat = {};
// O mapa salvo inteiro { [scope]: {...} }, lido no início e mantido sem sessão: o
// auto-envio falha FECHADO enquanto o login carrega ou caiu. null = ainda lendo.
let autoSendByScopeChat = null;
let autoSendLang = "off";
let autoSendBusy = false; // evita reentrância na interceptação do envio
let dispatchingSend = false; // o clique que NÓS disparamos não pode reentrar no interceptor
let structuredSendOverride = null; // { element, text, until }: 2º envio libera menção sem tradução
let sessionScope = "";
let currentChatKey = "";
let lastResolvedIdentity = null;
let chatKeyResolved = false; // a sonda já respondeu para a conversa visível?
let resolvedComposer = null; // composer da resposta da sonda; outro = outra conversa (mesmo título)
let chatContextVersion = 0;
let chatProbeInFlight = false;
let chatRefreshPending = false;
let chatRefreshTimer = null;
let lastChatProbeAt = 0;
const transcriptCache = new Map();
const hiddenTranscriptIds = new Set();
chrome.storage.local.get(["baseUrl", "autoSendByScopeChat"]).then((c) => {
  // Default de prod p/ os links do painel (auth por sessão não semeia o storage).
  baseUrl = (c.baseUrl || "https://app.adragencia.com.br").replace(/\/+$/, "");
  autoSendByScopeChat = c.autoSendByScopeChat || {};
  // Chaves globais legadas (pré-escopo por usuário/tenant) ficam fora: tradução de
  // recebidas era global e `autoSendByChat`/`autoTranscribe` não distinguiam usuário.
  chrome.storage.local.remove(["autoIncoming", "autoSendByChat", "autoTranscribe"]);
  refreshAutoButtons();
}).catch(() => {
  // Storage ilegível: sem preferência legível, não há o que proteger — não trava todo envio.
  autoSendByScopeChat = autoSendByScopeChat || {};
});

function loadTranscriptCache() {
  if (!sessionScope) return;
  send("getTranscriptCache", { scope: sessionScope })
    .then(({ items }) => {
      transcriptCache.clear();
      for (const [externalId, entry] of Object.entries(U.normalizeTranscriptCache(items))) {
        transcriptCache.set(externalId, entry.text);
      }
      rehydrateCachedTranscripts();
    })
    .catch(() => {
      // O banco do CRM continua sendo a fonte canônica; o cache apenas reidrata a interface.
    });
}

function clearCrmSessionState() {
    hasCrm = false;
    sessionScope = "";
    crmAuthState = "denied";
    autoTranscribe = false;
    // `autoSendByScopeChat` fica: sem sessão, a conversa com auto-envio segue bloqueada.
    autoSendByChat = {};
    autoSendLang = "off";
    transcriptCache.clear();
    autoTranscriptionQueue.length = 0;
    autoTranscriptionQueuedIds.clear();
    document.querySelector(".crmwa-fab")?.remove();
    document.querySelector(".crmwa-panel")?.remove();
    document.querySelector(".crmwa-toolbar")?.remove();
}

let whoamiFailureStreak = 0;
const WHOAMI_FAILURE_STREAK_LIMIT = 3;

async function refreshCrmSession() {
  const previousScope = sessionScope;
  try {
    const result = await send("whoami");
    whoamiFailureStreak = 0;
    const nextScope = result?.hasCrm ? String(result.scope || "") : "";
    if (!nextScope) return clearCrmSessionState();
    hasCrm = true;
    sessionScope = nextScope;
    crmAuthState = "allowed";
    if (previousScope !== nextScope) {
      transcriptCache.clear();
      currentTitle = "";
      autoTranscribe = false;
      const stored = await chrome.storage.local.get(["autoTranscribeByScope", "autoSendByScopeChat"]);
      autoTranscribe = !!stored.autoTranscribeByScope?.[sessionScope];
      autoSendByScopeChat = stored.autoSendByScopeChat || {};
      autoSendByChat = autoSendByScopeChat[sessionScope] || {};
      applyChatAutoSend();
      loadTranscriptCache();
    }
    refreshAutoButtons();
    setTimeout(tick, 0);
  } catch (error) {
    // Negação real de sessão: derruba o painel imediatamente.
    if (error?.status === 401 || error?.status === 403 || error?.code === "NOT_CONFIGURED") {
      whoamiFailureStreak = 0;
      return clearCrmSessionState();
    }
    // 5xx/timeout/erro de rede são transitórios (poll a cada 60s) — degrada sem
    // desmontar FAB/painel/toolbar/auto-transcrição na primeira falha; só derruba
    // após falhas consecutivas.
    whoamiFailureStreak += 1;
    if (whoamiFailureStreak >= WHOAMI_FAILURE_STREAK_LIMIT) {
      clearCrmSessionState();
    }
  }
}

refreshCrmSession();
setInterval(refreshCrmSession, 60_000);

function money(valueCents, currency) {
  if (valueCents == null) return "";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(
      valueCents / 100
    );
  } catch {
    return `${(valueCents / 100).toFixed(2)}`;
  }
}

function applyTheme() {
  document.body.classList.toggle("crmwa-dark", D.isDark());
}

let toastTimer;
function toast(message, isError = true) {
  let el = document.querySelector(".crmwa-toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "crmwa-toast";
    document.body.appendChild(el);
  }
  el.classList.toggle("crmwa-toast-err", isError);
  el.setAttribute("role", isError ? "alert" : "status");
  el.setAttribute("aria-live", isError ? "assertive" : "polite");
  el.textContent = message;
  el.classList.add("crmwa-toast-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("crmwa-toast-show"), 4000);
}

async function openOptions() {
  try {
    await send("openOptions");
  } catch {
    toast("Abra as opções da extensão em chrome://extensions.");
  }
}

// ---------- Painel de negócio ----------

let panelEl, panelBody, fab;
let currentTitle = "";
let currentLookupTarget = null;

function setPanelOpen(open) {
  if (!panelEl || !fab) return;
  panelEl.classList.toggle("crmwa-open", open);
  panelEl.setAttribute("aria-hidden", String(!open));
  fab.setAttribute("aria-expanded", String(open));
}

function ensurePanel() {
  if (fab?.isConnected && panelEl?.isConnected) return;
  fab = null;
  panelEl = null;
  panelBody = null;
  fab = document.createElement("button");
  fab.type = "button";
  fab.className = "crmwa-fab";
  fab.setAttribute("aria-label", "Abrir painel do CRM");
  fab.setAttribute("aria-controls", "crmwa-panel");
  fab.setAttribute("aria-expanded", "false");
  fab.innerHTML = `<span class="crmwa-fab-dot"></span>CRM`;
  fab.title = "Negócio deste contato no CRM";
  fab.onclick = (event) => {
    if (!event.isTrusted) return;
    const open = !panelEl.classList.contains("crmwa-open");
    setPanelOpen(open);
    if (open) loadCurrentChatPanel(true);
  };
  document.body.appendChild(fab);

  panelEl = document.createElement("div");
  panelEl.id = "crmwa-panel";
  panelEl.className = "crmwa-panel";
  panelEl.setAttribute("role", "region");
  panelEl.setAttribute("aria-label", "Contexto CRM da conversa");
  panelEl.setAttribute("aria-hidden", "true");
  panelEl.innerHTML = `
    <div class="crmwa-panel-head"><span>CRM ADR</span><button type="button" class="crmwa-x" aria-label="Fechar painel do CRM">×</button></div>
    <div class="crmwa-panel-body"><div class="crmwa-empty">Abra o painel para consultar este contato.</div></div>`;
  panelEl.querySelector(".crmwa-x").onclick = () => {
    setPanelOpen(false);
    fab.focus();
  };
  panelBody = panelEl.querySelector(".crmwa-panel-body");
  // Links do painel só abrem com clique do usuário: `.click()` da página não navega.
  panelEl.addEventListener("click", (e) => {
    if (!e.isTrusted && e.target?.closest?.("a")) e.preventDefault();
  }, true);
  document.body.appendChild(panelEl);
}

function renderNeedsConfig() {
  panelBody.innerHTML = `
    <div class="crmwa-empty">Sessão do CRM indisponível. Faça login no ambiente configurado.</div>
    <button class="crmwa-btn crmwa-block">Abrir opções</button>`;
  panelBody.querySelector(".crmwa-btn").onclick = (e) => {
    if (e.isTrusted) openOptions();
  };
}

// Handoffs do CRM: o painel NÃO escreve, ele abre a tela nativa já pré-preenchida.
// Vale para os dois — negócio e pessoa —, e por dois motivos: a detecção de duplicata
// e o seletor de empresa moram lá (e `POST /api/crm/contacts` EXIGE `companyId`), e
// rota de escrita nova a partir da extensão seria um segundo caminho de cadastro.
function encodeHandoff(payload) {
  return encodeURIComponent(btoa(encodeURIComponent(JSON.stringify(payload))));
}

function buildCreateDealUrl(phone, contact, fallbackName) {
  const payload = {};
  if (phone) payload.phone = phone;
  if (contact) {
    payload.contactId = contact.id;
    payload.contactName = contact.name;
    payload.companyId = contact.company?.id || contact.companyId || null;
    payload.companyName = contact.company?.name || null;
  } else {
    // "Pessoa | Empresa" / "Nome - Label" → pré-preenche Pessoa E Empresa em vez de jogar
    // tudo no campo Pessoa. (Contato salvo não expõe o telefone — @lid; fica pro usuário.)
    const { person, company } = U.titleParts(fallbackName);
    if (person) payload.contactName = person;
    if (company) payload.companyName = company;
  }
  return `${baseUrl}/negocios?createDealFrom=${encodeHandoff(payload)}`;
}

// `/empresas`, não `/contatos`: a pessoa nasce DENTRO da conta desde que as duas listas
// viraram uma, e `/contatos` redireciona — o `redirect` do Next não leva a query, então
// o handoff chegaria vazio. Contrato lido por `lib/crm/create-contact-handoff.ts`.
function buildCreateContactUrl(phone, fallbackName) {
  const payload = { source: "whatsapp-extension" };
  if (phone) payload.phone = phone;
  const { person } = U.titleParts(fallbackName);
  if (person) payload.name = person;
  return `${baseUrl}/empresas?createContactFrom=${encodeHandoff(payload)}`;
}

function companyHref(company) {
  if (!company) return "#";
  return company.number
    ? `${baseUrl}/empresas/${encodeURIComponent(company.number)}`
    : `${baseUrl}/empresas?search=${encodeURIComponent(company.name || "")}`;
}

// Rótulos PT dos status "abertos" de projeto (o enum do banco é em inglês). Concluído/
// arquivado nunca chegam aqui (filtrados no background).
const PROJECT_STATUS_PT = {
  draft: "Rascunho",
  briefing: "Briefing",
  approval: "Aprovação",
  ready: "Pronto",
  in_progress: "Em andamento",
  waiting_client: "Aguardando cliente",
  blocked: "Bloqueado",
  post_campaign: "Pós-campanha",
};

function projectCard(p) {
  const link = baseUrl ? `${baseUrl}/projetos/${encodeURIComponent(p.id)}` : "#";
  return `<a class="crmwa-card crmwa-card-link" href="${esc(link)}" target="_blank" rel="noreferrer">
    <div class="crmwa-card-title">${esc(p.title || "(sem título)")}</div>
    <div class="crmwa-card-meta">
      ${p.status ? `<span class="crmwa-badge">${esc(PROJECT_STATUS_PT[p.status] || p.status)}</span>` : ""}
    </div>
  </a>`;
}

function dealCard(d) {
  const link = baseUrl ? `${baseUrl}/negocios/${encodeURIComponent(d.number)}` : "#";
  return `<a class="crmwa-card crmwa-card-link" href="${esc(link)}" target="_blank" rel="noreferrer">
    <div class="crmwa-card-title">${esc(d.title || "(sem título)")}</div>
    <div class="crmwa-card-meta">
      ${d.stage?.name ? `<span class="crmwa-badge">${esc(d.stage.name)}</span>` : ""}
      ${d.valueCents != null ? `<span>${esc(money(d.valueCents, d.currency))}</span>` : ""}
      ${d.ownerDisplayName ? `<span class="crmwa-muted">• ${esc(d.ownerDisplayName)}</span>` : ""}
    </div>
  </a>`;
}

function contactHref(contact) {
  if (!contact) return "#";
  // `/contatos/<numero>` é a URL pública da pessoa (o workspace lê o número do caminho
  // e abre a gaveta). Sem número — cadastro antigo sem `number` —, cai na busca.
  return contact.number
    ? `${baseUrl}/contatos/${encodeURIComponent(contact.number)}`
    : `${baseUrl}/empresas?search=${encodeURIComponent(contact.name || "")}`;
}

function contactCard(contact) {
  const meta = [contact.company?.name, contact.role, contact.phone || contact.whatsapp]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  return `<a class="crmwa-card crmwa-card-link" href="${esc(contactHref(contact))}" target="_blank" rel="noreferrer">
    <div class="crmwa-card-title">${esc(contact.name || "(sem nome)")}</div>
    ${meta.length ? `<div class="crmwa-card-meta crmwa-muted">${esc(meta.join(" • "))}</div>` : ""}
  </a>`;
}

function createContactButton(phone, fallbackName) {
  return `<a class="crmwa-btn crmwa-btn-ghost crmwa-block" href="${esc(buildCreateContactUrl(phone, fallbackName))}" target="_blank" rel="noreferrer">Salvar pessoa no CRM</a>`;
}

function createDealButton(phone, contact, fallbackName) {
  return `<a class="crmwa-btn crmwa-block" href="${esc(buildCreateDealUrl(phone, contact, fallbackName))}" target="_blank" rel="noreferrer">+ Criar negócio</a>`;
}

/**
 * Caminho, e não URL: o `baseUrl` chega assíncrono do storage, e quem chama do
 * lado do desktop passa `path` para `adrCrm.openCrm` — que monta a base sozinho.
 * Separar os dois é o que deixa o botão do cabeçalho do WhatsApp reusar ESTA
 * montagem em vez de reimplementar uma versão com menos parâmetros.
 */
function buildCreateCompanyPath(phone, contact, fallbackName) {
  const params = new URLSearchParams();
  const contactPhone = contact?.phone || phone || "";
  const contactName = contact?.name || "";
  let suggestedCompanyName = "";
  let suggestedContactName = contactName;

  // Testa o NOME, não o contato: cadastro só por telefone (importação) existe na
  // base com `name` vazio, e a guarda anterior (`!contact`) pulava o fallback
  // justamente nesses — a tela de vincular abria em branco com "João | Acme" no
  // cabeçalho, porque `params.set` descarta valor vazio.
  // `U.titleParts` (0.15.0) é a MESMA separação, mas validando parte por parte: sem
  // ela, "+55 11 9999 | Dola" mandava o telefone no campo de pessoa.
  if (!contactName) {
    const { person, company } = U.titleParts(fallbackName);
    suggestedContactName = person;
    suggestedCompanyName = company;
  }

  const values = [
    ["vincularEmpresaNome", suggestedCompanyName],
    ["vincularEmpresaContatoNome", suggestedContactName],
    ["vincularEmpresaTelefone", contactPhone],
    ["vincularEmpresaContatoId", contact?.id || ""],
  ];
  for (const [key, value] of values) {
    if (value) params.set(key, value);
  }
  return `/negocios?${params.toString()}`;
}

/** O app desktop injeta este arquivo dentro de uma IIFE — sem isto, nada sai daqui. */
window.__adrCrmCreateCompanyPath = buildCreateCompanyPath;

function buildCreateCompanyUrl(phone, contact, fallbackName) {
  return `${baseUrl}${buildCreateCompanyPath(phone, contact, fallbackName)}`;
}

function createCompanyButton(phone, contact, fallbackName) {
  return `<a class="crmwa-btn crmwa-block" href="${esc(buildCreateCompanyUrl(phone, contact, fallbackName))}" target="_blank" rel="noreferrer">+ Criar empresa</a>`;
}

// Busca é SEMPRE por telefone. Estados: (1) negócio aberto → lista; (2) tem cadastro mas
// nenhum aberto → empresa (se houver) + Criar negócio; (3) nada na base → aviso + Criar
// negócio. O Criar negócio sempre leva o telefone (e o nome do cabeçalho, se houver).
function renderLookup(data, phone, displayName) {
  const deals = data.deals || [];
  const contacts = data.contacts || [];
  const isOpen = (d) => String(d.status || "").toUpperCase() === "OPEN";
  const openDeals = deals.filter(isOpen);
  const otherDeals = deals.filter((d) => !isOpen(d));
  const bestContact = contacts[0] || null;
  const company = bestContact?.company || null;
  const label = displayName || bestContact?.name || phone;

  let html = `<div class="crmwa-searched">Contato: <b>${esc(label)}</b><button type="button" class="crmwa-change">por número</button></div>`;
  if (data.warnings?.length) {
    html += `<div class="crmwa-empty crmwa-warning">Dados parciais: ${esc(data.warnings.join(" "))}</div>`;
  }

  if (!contacts.length && !deals.length) {
    // (3) Número não está na base.
    html += `<div class="crmwa-empty">Nada encontrado na base para este número.</div>`;
    html += createContactButton(phone, displayName);
    html += createCompanyButton(phone, null, displayName);
    html += createDealButton(phone, null, displayName);
  } else {
    // A PESSOA vem primeiro, e como cartão clicável: antes ela só aparecia como
    // rótulo no topo (que mostra o nome do WhatsApp, não o do CRM) e como lista
    // MUDA depois de todos os negócios — com 11 deles, fora da tela. Quem abre o
    // painel precisa saber, na primeira linha, se esta pessoa já está cadastrada.
    html += `<div class="crmwa-section">${contacts.length > 1 ? "Pessoas no CRM" : "Pessoa no CRM"}</div>`;
    if (contacts.length) {
      for (const c of contacts) html += contactCard(c);
    } else {
      html += `<div class="crmwa-empty">Este número não tem pessoa cadastrada.</div>`;
      html += createContactButton(phone, displayName);
    }

    if (company) {
      html += `<div class="crmwa-section">Empresa</div>
        <a class="crmwa-card crmwa-card-link" href="${esc(companyHref(company))}" target="_blank" rel="noreferrer">
          <div class="crmwa-card-title">${esc(company.name || "(sem nome)")}</div>
        </a>`;
    }

    if (!company) html += createCompanyButton(phone, bestContact, displayName);

    html += `<div class="crmwa-section">Negócios abertos</div>`;
    if (openDeals.length) {
      for (const d of openDeals) html += dealCard(d); // (1)
    } else {
      html += `<div class="crmwa-empty">Nenhum negócio aberto.</div>`;
      html += createDealButton(phone, bestContact, displayName); // (2)
    }

    if (otherDeals.length) {
      html += `<div class="crmwa-section">Outros negócios (${otherDeals.length})</div>`;
      for (const d of otherDeals) html += dealCard(d);
    }

    const projects = data.projects || [];
    if (projects.length) {
      html += `<div class="crmwa-section">Projetos em aberto</div>`;
      for (const p of projects) html += projectCard(p);
    }
  }

  panelBody.innerHTML = html;
  const change = panelBody.querySelector(".crmwa-change");
  if (change) change.onclick = (e) => {
    if (e.isTrusted) manualPhonePrompt(true);
  };
}

async function runLookup(phone, displayName, contextVersion = chatContextVersion, contextKey = currentChatKey) {
  panelBody.innerHTML = `<div class="crmwa-empty">Buscando ${esc(displayName || phone)}…</div>`;
  const contextIsCurrent = () =>
    contextVersion === chatContextVersion &&
    contextKey === currentChatKey &&
    resolveVisibleChatKey() === contextKey;
  try {
    const data = await send("lookup", {
      phone,
      name: displayName,
      requestId: `${contextVersion}:${contextKey}`,
      scope: sessionScope,
    });
    if (!contextIsCurrent()) return;
    renderLookup(data, phone, displayName);
  } catch (err) {
    if (!contextIsCurrent()) return;
    if (err.code === "NOT_CONFIGURED") return renderNeedsConfig();
    panelBody.innerHTML = `<div class="crmwa-empty crmwa-err">${esc(err.message)}</div>`;
  }
}

function loadCurrentChatPanel(focus = false) {
  if (!panelBody) return;
  const target = currentLookupTarget;
  if (!target || target.contextVersion !== chatContextVersion || target.contextKey !== currentChatKey) {
    panelBody.innerHTML = '<div class="crmwa-empty">Não foi possível confirmar a identidade desta conversa. Busque pelo número.</div>';
    manualPhonePrompt(focus);
    return;
  }
  if (target.phone) {
    runLookup(target.phone, target.name, target.contextVersion, target.contextKey);
  } else {
    manualPhonePrompt(focus);
  }
}

function lookupPhone(phone, name) {
  return runLookup(phone, name);
}

function manualPhonePrompt(focus = false) {
  panelBody.innerHTML = `
    <div class="crmwa-empty">Buscar no CRM pelo número:</div>
    <div class="crmwa-manual">
      <input type="text" inputmode="tel" placeholder="ex: 5543991615858" class="crmwa-input" />
      <button class="crmwa-btn">Buscar</button>
    </div>`;
  const input = panelBody.querySelector(".crmwa-input");
  const run = (e) => {
    // Busca no CRM só por gesto do usuário: a página não usa o painel como oráculo.
    if (!e.isTrusted) return;
    const digits = D.phoneDigits(input.value);
    if (digits.length >= 8) lookupPhone(digits);
    else toast("Digite ao menos 8 dígitos.");
  };
  panelBody.querySelector(".crmwa-btn").onclick = run;
  input.addEventListener("keydown", (e) => e.key === "Enter" && run(e));
  // Foco só quando o usuário abriu a busca: senão roubava o cursor do composer.
  if (focus) input.focus();
}

// Remove emojis/símbolos do nome do cabeçalho para a busca por nome.
function cleanName(s) {
  return String(s || "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveVisibleChatKey(identity = lastResolvedIdentity, raw = D.headerTitle()) {
  const stableIdentity = identity || (D.looksLikePhone(raw) ? { phone: D.phoneDigits(raw) } : null);
  return U.chatKey(stableIdentity, "");
}

function markPotentialChatChange() {
  const raw = D.headerTitle();
  if (!raw || !currentTitle || raw === currentTitle) return;
  currentTitle = raw;
  currentChatKey = "";
  chatKeyResolved = false;
  lastResolvedIdentity = null;
  currentLookupTarget = null;
  chatContextVersion += 1;
  lastChatProbeAt = 0;
  if (panelBody) panelBody.innerHTML = '<div class="crmwa-empty">Conversa alterada. Identificando o novo contato…</div>';
  setPanelOpen(false);
}

function scheduleChatContextRefresh(delay = 0) {
  markPotentialChatChange();
  chatRefreshPending = true;
  if (chatRefreshTimer !== null) {
    if (delay > 0) return;
    clearTimeout(chatRefreshTimer);
    chatRefreshTimer = null;
  }
  chatRefreshTimer = setTimeout(() => {
    chatRefreshTimer = null;
    refreshChatContext().catch(() => {});
  }, delay);
}

async function refreshChatContext() {
  if (chatProbeInFlight) {
    chatRefreshPending = true;
    return;
  }
  const raw = D.headerTitle();
  if (!raw) return;
  const throttleRemaining = 350 - (Date.now() - lastChatProbeAt);
  if (throttleRemaining > 0) {
    scheduleChatContextRefresh(throttleRemaining);
    return;
  }
  chatRefreshPending = false;
  chatProbeInFlight = true;
  lastChatProbeAt = Date.now();
  // Conversas com o mesmo título: o composer remontado é o sinal de troca que sobra.
  const composerAtProbe = D.mainComposer();
  let identity = null;
  try {
    identity = await getChatIdentity();
  } finally {
    chatProbeInFlight = false;
    if (chatRefreshPending) scheduleChatContextRefresh(50);
  }
  if (D.headerTitle() !== raw || D.mainComposer() !== composerAtProbe) return;
  lastResolvedIdentity = identity;
  resolvedComposer = composerAtProbe;
  const nextKey = resolveVisibleChatKey(identity, raw);
  if (!nextKey) {
    // Mesma conversa sem chave: a busca manual (ou o resultado dela) já está na tela;
    // refazer a cada sonda apagava os dígitos digitados.
    if (chatKeyResolved && raw === currentTitle && !currentChatKey) return;
    currentTitle = raw;
    currentChatKey = "";
    chatKeyResolved = true;
    currentLookupTarget = null;
    applyChatAutoSend();
    if (panelEl?.classList.contains("crmwa-open") && !panelBody?.querySelector(".crmwa-manual")) {
      manualPhonePrompt();
    }
    return;
  }
  chatKeyResolved = true;
  if (raw === currentTitle && nextKey === currentChatKey) return;

  currentTitle = raw;
  currentChatKey = nextKey;
  chatContextVersion += 1;
  applyChatAutoSend(); // carrega o "auto ao enviar" salvo desta conversa
  refreshAutoButtons();
  if (!hasCrm) return; // sem login no CRM: recursos autenticados permanecem indisponíveis
  ensurePanel();
  // BUSCA SEMPRE POR TELEFONE. Não salvo => o cabeçalho já é o número. Salvo (mesmo @lid)
  // => pega o número real via probe no mundo principal. Sem número => busca manual.
  const isPhone = D.looksLikePhone(raw);
  const name = isPhone ? "" : cleanName(raw);
  const phone = isPhone ? D.phoneDigits(raw) : identity?.phone;
  currentLookupTarget = {
    phone: phone || "",
    name,
    contextVersion: chatContextVersion,
    contextKey: currentChatKey,
  };
  if (panelBody) panelBody.innerHTML = '<div class="crmwa-empty">Abra o painel para consultar este contato.</div>';
  if (panelEl?.classList.contains("crmwa-open")) loadCurrentChatPanel();
}

// ---------- Tradução de mensagens recebidas ----------

function bubbleRuntimeKey(bubble) {
  const externalId = D.bubbleExternalId(bubble);
  const text = D.bubbleText(bubble);
  return `${currentChatKey}|${externalId || `text:${text.length}:${text.slice(0, 120)}`}`;
}

function prepareBubbleRuntime(bubble) {
  const key = bubbleRuntimeKey(bubble);
  if (bubble.dataset.crmTrKey === key) return { key, fresh: false };
  for (const node of bubble.querySelectorAll(".crmwa-tr-btn,.crmwa-tr-out,.crmwa-tr-transcript,.crmwa-tr-audiowrap")) {
    node.remove();
  }
  delete bubble.dataset.crmBusy;
  delete bubble.dataset.crmTrWait;
  bubble.dataset.crmTrKey = key;
  return { key, fresh: true };
}

function captureBubbleContext(bubble) {
  return {
    bubble,
    runtimeKey: bubbleRuntimeKey(bubble),
    chatKey: currentChatKey,
    contextVersion: chatContextVersion,
    externalId: D.bubbleExternalId(bubble),
    sourceText: D.bubbleText(bubble),
  };
}

function isBubbleContextCurrent(context) {
  return !!context?.chatKey &&
    context.bubble?.isConnected &&
    context.contextVersion === chatContextVersion &&
    context.chatKey === currentChatKey &&
    context.chatKey === resolveVisibleChatKey() &&
    context.runtimeKey === bubbleRuntimeKey(context.bubble) &&
    context.externalId === D.bubbleExternalId(context.bubble) &&
    context.sourceText === D.bubbleText(context.bubble);
}

// Onde anexar tradução/transcrição: dentro do balão de texto (.copyable-text) para
// ficar alinhado à mensagem; se não houver (áudio/mídia), na própria linha.
function bubbleBody(row) {
  return row.querySelector(".copyable-text") || row;
}

// Mostra a transcrição centralizada sob a forma de onda, com × pra fechar.
function showTranscript(bubble, text, externalId = D.bubbleExternalId(bubble), context = null) {
  if (context && !isBubbleContextCurrent(context)) return "";
  const existing = bubble.querySelector(".crmwa-tr-transcript");
  if (existing) {
    const existingText = existing.querySelector(".crmwa-tr-transcript-text");
    // Só escreve se mudou: reescrever a cada tick gerava mutação → novo tick → loop.
    if (existingText && existingText.textContent !== `🎙️ ${text}`) existingText.textContent = `🎙️ ${text}`;
    bubble.querySelector(".crmwa-tr-audiowrap")?.remove();
    return text;
  }
  const tr = document.createElement("div");
  tr.className = "crmwa-tr-transcript";
  const span = document.createElement("span");
  span.className = "crmwa-tr-transcript-text";
  span.textContent = `🎙️ ${text}`;
  const close = document.createElement("button");
  close.className = "crmwa-tr-x";
  close.textContent = "×";
  close.title = "Fechar transcrição";
  close.onclick = (e) => {
    e.stopPropagation();
    if (externalId) hiddenTranscriptIds.add(externalId);
    tr.remove();
  };
  tr.append(span, close);
  bubble.querySelector(".crmwa-tr-audiowrap")?.remove();
  (D.audioBox(bubble) || bubbleBody(bubble)).appendChild(tr);
  return text;
}

function rehydrateCachedTranscripts() {
  for (const bubble of D.visibleIncomingBubbles()) {
    if (!D.isAudioBubble(bubble)) continue;
    const externalId = D.bubbleExternalId(bubble);
    const text = externalId ? transcriptCache.get(externalId) : "";
    if (!externalId || !text || hiddenTranscriptIds.has(externalId)) continue;
    // Só consome a execução da bolha quando há uma transcrição para reidratar.
    // `tick()` chama esta função antes de `addBubbleTranslateButtons`; preparar aqui
    // uma bolha sem cache faria o criador do botão enxergá-la como já processada e
    // o botão manual de transcrição nunca seria inserido.
    prepareBubbleRuntime(bubble);
    const context = captureBubbleContext(bubble);
    showTranscript(bubble, text, externalId, context);
  }
}

// Transcreve a nota de voz da bolha pelo SERVIDOR (rebaixa a mídia pela gateway a partir do
// id da mensagem). Só pra usuário CRM cujas mensagens estão no CRM — o botão só aparece
// nesses casos (ver addBubbleTranslateButtons). Extração client-side foi descartada:
// validado ao vivo que o WhatsApp não expõe o áudio por Web Audio/<audio>, e a WA-JS (Store
// interno) está quebrada na build atual do WhatsApp.
async function transcribeBubble(bubble) {
  const context = captureBubbleContext(bubble);
  if (!isBubbleContextCurrent(context)) throw Object.assign(new Error("a conversa mudou"), { code: "CONTEXT_CHANGED" });
  const externalId = D.bubbleExternalId(bubble);
  if (!externalId) throw new Error("não identifiquei esta mensagem de áudio");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Áudio recém-chegado pode ainda não ter sido ingerido no CRM (404 até o webhook
  // gravar a mensagem): re-tenta sozinho em vez de exigir novo clique do usuário. A
  // ingestão em burst espera o cron (a cada 1 min); medido que a transcrição em si é
  // ~1s — o "demora minutos" era desistir cedo demais (10s) e cair no botão manual.
  // Prazo por TEMPO, não por contagem: segura até sincronizar e some com o re-clique.
  // isBubbleContextCurrent aborta na hora se o usuário trocar de conversa.
  const SYNC_WAIT_DEADLINE = Date.now() + 120_000;
  let res = null;
  for (let attempt = 0; !res; attempt++) {
    try {
      res = await send("transcribeMessage", { externalId, remoteJid: lastResolvedIdentity?.id || "" });
    } catch (err) {
      if (err?.status !== 404 || Date.now() >= SYNC_WAIT_DEADLINE) throw err;
      // 1s: o 404 agora ADIANTA a drenagem da fila no servidor (ver
      // webhook-ingest-on-demand), então a próxima tentativa costuma já achar a
      // mensagem — esperar 3s só somava atraso a um trabalho que já terminou.
      await wait(1000);
      if (!isBubbleContextCurrent(context)) throw Object.assign(new Error("a conversa mudou"), { code: "CONTEXT_CHANGED" });
    }
  }
  // Poll progressivo: rápido no caminho feliz, espaçado no lento.
  const delays = [1500, 2500, 4000, 4000, 6000, 6000, 8000];
  for (let i = 0; res.status === "pending" && i < delays.length; i++) {
    await wait(delays[i]);
    if (!isBubbleContextCurrent(context)) throw Object.assign(new Error("a conversa mudou"), { code: "CONTEXT_CHANGED" });
    res = await send("transcribeMessage", { externalId, remoteJid: lastResolvedIdentity?.id || "" });
  }
  if (res.status === "pending") {
    throw new Error("a transcrição ainda está em andamento — tente de novo em instantes");
  }
  if (res.status !== "completed" || !res.text) throw new Error(res.error || "transcrição indisponível");
  if (!isBubbleContextCurrent(context)) throw Object.assign(new Error("a conversa mudou"), { code: "CONTEXT_CHANGED" });
  hiddenTranscriptIds.delete(externalId);
  transcriptCache.set(externalId, res.text);
  try {
    await send("cacheTranscript", { scope: sessionScope, externalId, text: res.text });
  } catch {
    // A transcrição concluída já está persistida no CRM; cache de sessão é complementar.
  }
  return showTranscript(bubble, res.text, externalId, context);
}

async function translateBubble(bubble, btn) {
  if (bubble.querySelector(".crmwa-tr-out") || bubble.dataset.crmBusy) return;
  const context = captureBubbleContext(bubble);
  if (!isBubbleContextCurrent(context)) return { ok: false, code: "CONTEXT_CHANGED" };
  bubble.dataset.crmBusy = "1";
  const reset = () => {
    delete bubble.dataset.crmBusy;
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🌐 traduzir";
    }
  };

  let text = D.bubbleText(bubble);
  try {
    // Áudio sem texto: transcreve primeiro.
    if (!text && D.isAudioBubble(bubble)) {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "…";
      }
      text = await transcribeBubble(bubble);
      if (!text) return reset();
    }
    if (!text) {
      if (btn) {
        btn.textContent = "—";
        btn.disabled = true;
      }
      delete bubble.dataset.crmBusy;
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = "traduzindo…";
    }
    const { translatedText } = await send("translate", { text, target: "pt-BR" });
    if (!isBubbleContextCurrent(context)) return { ok: false, code: "CONTEXT_CHANGED" };
    if (!translatedText) {
      // o motor entendeu que já está em português (mesmo idioma).
      toast("Mensagem já está em português.", false);
      delete bubble.dataset.crmBusy;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "🌐 traduzir";
      }
      return;
    }
    const out = document.createElement("div");
    out.className = "crmwa-tr-out";
    out.textContent = translatedText;
    bubbleBody(bubble).appendChild(out);
    delete bubble.dataset.crmBusy;
    if (btn) btn.remove();
    return { ok: true };
  } catch (err) {
    if (err.code !== "CONTEXT_CHANGED") toast(`Falhou: ${err.message}`);
    reset();
    return { ok: false, code: err.code || String(err.status || "ERROR") };
  }
}

// Botão de transcrever para notas de voz (que não têm texto).
async function transcribeBubbleWithBtn(bubble, btn) {
  if (bubble.dataset.crmBusy) return;
  bubble.dataset.crmBusy = "1";
  btn.disabled = true;
  btn.textContent = "transcrevendo… (pode levar até 1 min)";
  try {
    const text = await transcribeBubble(bubble);
    if (text) (btn.closest(".crmwa-tr-audiowrap") || btn).remove();
    else {
      btn.disabled = false;
      btn.textContent = "🎙️ transcrever";
    }
  } catch (err) {
    if (err.code !== "CONTEXT_CHANGED") toast(`Falhou: ${err.message}`);
    btn.disabled = false;
    btn.textContent = "🎙️ transcrever";
  } finally {
    delete bubble.dataset.crmBusy;
  }
}

const AUTO_TRANSCRIBE_MAX_AGE_MS = 5 * 60 * 1000;
const autoTranscriptionQueue = [];
const autoTranscriptionQueuedIds = new Set();
let autoTranscriptionRunning = false;

function isRecentAudioBubble(bubble) {
  const sentAt = D.bubbleSentAtMs(bubble);
  return Number.isFinite(sentAt) && Date.now() - sentAt >= 0 && Date.now() - sentAt <= AUTO_TRANSCRIBE_MAX_AGE_MS;
}

function enqueueAutoTranscription(bubble, btn) {
  const externalId = D.bubbleExternalId(bubble);
  if (!autoTranscribe || !externalId || !isRecentAudioBubble(bubble) || autoTranscriptionQueuedIds.has(externalId)) return;
  autoTranscriptionQueuedIds.add(externalId);
  autoTranscriptionQueue.push({ bubble, btn, externalId, context: captureBubbleContext(bubble) });
  processAutoTranscriptionQueue();
}

async function processAutoTranscriptionQueue() {
  if (autoTranscriptionRunning) return;
  autoTranscriptionRunning = true;
  try {
    while (autoTranscribe && autoTranscriptionQueue.length) {
      const item = autoTranscriptionQueue.shift();
      if (isBubbleContextCurrent(item.context) && item.btn?.isConnected) {
        await transcribeBubbleWithBtn(item.bubble, item.btn);
      }
      autoTranscriptionQueuedIds.delete(item.externalId);
    }
  } finally {
    autoTranscriptionRunning = false;
  }
}

function addBubbleTranslateButtons() {
  for (const bubble of D.newIncomingBubbles()) {
    const runtime = prepareBubbleRuntime(bubble);
    if (!runtime.fresh && !bubble.dataset.crmTrWait) continue;
    if (bubble.querySelector(".crmwa-tr-btn")) {
      continue;
    }
    const text = D.bubbleText(bubble);
    // O WhatsApp monta a linha antes de hidratar o player da nota de voz. Se ainda não há
    // texto nem áudio detectável, adia algumas passadas em vez de consumir a bolha — senão
    // o botão "transcrever" sumia pra sempre quando o player montava depois. Após o limite,
    // desiste (é mídia sem áudio, ex.: imagem/vídeo) e marca como processada.
    if (!text && !D.isAudioBubble(bubble)) {
      const tries = (Number(bubble.dataset.crmTrWait) || 0) + 1;
      if (tries < 8) {
        bubble.dataset.crmTrWait = String(tries);
        continue;
      }
    }
    // Nota de voz (sem texto): oferece transcrever — SÓ pra usuário CRM (a transcrição é
    // pelo servidor/gateway; sem CRM não há como transcrever áudio pessoal). Ver transcribeBubble.
    if (!text && D.isAudioBubble(bubble)) {
      // Sem CRM (carregando ou caiu): não consome a bolha — quando o login voltar, a
      // próxima passada cria o botão sem precisar trocar de conversa.
      if (!hasCrm) {
        delete bubble.dataset.crmTrKey;
        continue;
      }
      const externalId = D.bubbleExternalId(bubble);
      const cachedTranscript = externalId ? transcriptCache.get(externalId) : "";
      if (cachedTranscript && !hiddenTranscriptIds.has(externalId)) {
        showTranscript(bubble, cachedTranscript, externalId);
        continue;
      }
      const btn = document.createElement("button");
      btn.className = "crmwa-tr-btn crmwa-tr-btn-audio";
      btn.textContent = "🎙️ transcrever";
      btn.title = "Transcrever esta mensagem de voz (via CRM)";
      btn.onclick = (e) => {
        e.stopPropagation();
        if (e.isTrusted) transcribeBubbleWithBtn(bubble, btn);
      };
      // Wrapper centraliza o pill sob a forma de onda; ancora no container do áudio
      // (não na linha inteira) pra largura bater com a do balão.
      const wrap = document.createElement("div");
      wrap.className = "crmwa-tr-audiowrap";
      wrap.appendChild(btn);
      (D.audioBox(bubble) || bubbleBody(bubble)).appendChild(wrap);
      enqueueAutoTranscription(bubble, btn);
      continue;
    }
    // só oferece traduzir quando a mensagem parece inglês/espanhol (não PT).
    if (!D.shouldOfferTranslate(text)) continue;
    const btn = document.createElement("button");
    btn.className = "crmwa-tr-btn";
    btn.textContent = "🌐 traduzir";
    btn.title = "Traduzir esta mensagem para português";
    btn.onclick = (e) => {
      e.stopPropagation();
      if (e.isTrusted) translateBubble(bubble, btn);
    };
    // link discreto ABAIXO da mensagem; some quando a tradução aparece no lugar.
    bubbleBody(bubble).appendChild(btn);
  }
}

// ---------- Copiar e-mail das mensagens ----------
// Recebidas e enviadas, com ou sem login no CRM: só lê o texto da bolha.
// Classe e marcação próprias (não `.crmwa-tr-btn`/`crmTrKey`): prepareBubbleRuntime
// limpa os botões de tradução quando a bolha muda, e levaria este junto sem
// que esta passada soubesse que precisa recriá-lo.
// Roda logo depois de addBubbleTranslateButtons, no mesmo tick, que já gravou
// `crmTrKey` (= bubbleRuntimeKey) em toda recebida: reaproveitar evita refazer
// as consultas de DOM da chave a cada mutação. Só as enviadas calculam aqui.
function addBubbleEmailButtons() {
  for (const bubble of D.visibleBubbles()) {
    const key = bubble.dataset.crmTrKey || bubbleRuntimeKey(bubble);
    if (bubble.dataset.crmEmailKey === key) continue;
    bubble.dataset.crmEmailKey = key;
    bubble.querySelector(".crmwa-email-row")?.remove();
    const emails = D.emailsInText(D.bubbleText(bubble));
    if (!emails.length) continue;
    const row = document.createElement("div");
    row.className = "crmwa-email-row";
    for (const email of emails) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "crmwa-email-btn";
      btn.textContent = emails.length === 1 ? "📋 copiar e-mail" : `📋 ${email}`;
      btn.title = `Copiar ${email}`;
      btn.onclick = (e) => {
        e.stopPropagation();
        if (e.isTrusted) copyEmail(email);
      };
      row.appendChild(btn);
    }
    bubbleBody(bubble).appendChild(row);
  }
}

async function copyEmail(email) {
  try {
    await navigator.clipboard.writeText(email);
    toast(`E-mail copiado: ${email}`, false);
  } catch {
    toast(`Não foi possível copiar. Selecione e copie: ${email}`);
  }
}

async function translateAllVisible(btn) {
  if (btn.disabled) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Traduzindo…";
  const batchContext = { chatKey: currentChatKey, contextVersion: chatContextVersion };
  let processed = 0;
  try {
    for (const bubble of D.visibleIncomingBubbles()) {
      if (batchContext.chatKey !== currentChatKey || batchContext.contextVersion !== chatContextVersion) break;
      if (processed >= 10) {
        toast("Lote limitado a 10 mensagens para proteger a cota de tradução.", false);
        break;
      }
      if (bubble.querySelector(".crmwa-tr-out")) continue;
      const text = D.bubbleText(bubble);
      if (!D.shouldOfferTranslate(text)) continue; // pula PT e textos sem idioma claro
      const result = await translateBubble(bubble, bubble.querySelector(".crmwa-tr-btn"));
      processed += 1;
      if (result?.code === "TRANSLATE_RATE_LIMIT_EXCEEDED" || result?.code === "429") break;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ---------- Barra de ferramentas no composer ----------

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

let composerMutationInFlight = false;
// Rollback sem confirmação: o campo pode ter ficado com texto meio aplicado.
const RESTORE_FAILED_MSG = "Não consegui desfazer a alteração no campo. Confira o texto antes de enviar.";

function captureComposerContext() {
  return {
    chatKey: currentChatKey,
    contextVersion: chatContextVersion,
    element: D.composer(),
  };
}

function isComposerContextCurrent(context) {
  return !!context?.chatKey &&
    context.contextVersion === chatContextVersion &&
    context.chatKey === currentChatKey &&
    context.chatKey === resolveVisibleChatKey() &&
    context.element?.isConnected &&
    D.composer() === context.element;
}

async function replaceComposerTextSafely(target, expectedOriginal, context = captureComposerContext()) {
  if (composerMutationInFlight) return { ok: false, reason: "busy" };
  if (!isComposerContextCurrent(context)) return { ok: false, reason: "chat_changed" };
  if (D.composerHasStructuredContent(context.element)) return { ok: false, reason: "structured" };
  const before = D.composerReadText(context.element);
  if (expectedOriginal != null && !U.isSameComposerText(before, expectedOriginal)) {
    return { ok: false, reason: "changed" };
  }
  composerMutationInFlight = true;
  const guard = () => isComposerContextCurrent(context);
  try {
    const result = await D.setComposerText(target, context.element, guard);
    if (result?.restored === false) return { ok: false, reason: "restore_failed" };
    if (!result?.ok) return { ok: false, reason: guard() ? "replace_failed" : "chat_changed" };

    // Confirma depois de duas reconciliações do Lexical; igualdade imediata não basta.
    await nextAnimationFrame();
    await nextAnimationFrame();
    // O texto novo JÁ foi aplicado e, sem a conversa, não há como desfazer.
    if (!guard()) return { ok: false, reason: "restore_failed" };
    if (U.isSameComposerText(D.composerReadText(context.element), target)) return { ok: true };

    const restored = await D.restoreComposer(result.snapshot, guard);
    await nextAnimationFrame();
    return { ok: false, reason: restored ? "reconciled_back" : "restore_failed" };
  } finally {
    composerMutationInFlight = false;
  }
}

async function translateComposer(target, btn) {
  if (btn.disabled) return;
  const el = D.composer();
  const text = el ? (el.innerText || "").trim() : "";
  if (!text) return toast("Nada para traduzir no campo de mensagem.", false);
  const context = captureComposerContext();
  if (!isComposerContextCurrent(context)) return toast("Não consegui confirmar a conversa atual.");
  if (D.composerHasStructuredContent(el)) {
    return toast("Esta mensagem contém menção ou conteúdo estruturado; preserve-a sem tradução automática.");
  }
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const { translatedText } = await send("translate", { text, target });
    if (!translatedText) return toast("O texto já está no idioma escolhido.", false);
    const replaced = await replaceComposerTextSafely(translatedText, text, context);
    if (!replaced.ok) {
      toast(
        replaced.reason === "restore_failed"
          ? RESTORE_FAILED_MSG
          : replaced.reason === "changed"
          ? "O campo mudou durante a tradução; mantive o texto mais recente."
          : replaced.reason === "chat_changed"
            ? "A conversa mudou durante a tradução; nenhum texto foi aplicado."
            : replaced.reason === "structured"
              ? "A mensagem contém uma menção ou chip que não pode ser alterado com segurança."
          : "Não consegui substituir o texto com segurança; o original foi preservado."
      );
    }
  } catch (err) {
    toast(`Tradução falhou: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

let activeMenuAbortController = null;

function closeQuickReplies() {
  activeMenuAbortController?.abort();
  activeMenuAbortController = null;
  document.querySelector(".crmwa-qr-menu")?.remove();
}

function placeMenu(menu, anchor) {
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - 320));
  menu.style.left = `${left}px`;
  menu.style.bottom = `${Math.max(8, window.innerHeight - r.top + 8)}px`;
}

function registerMenuDismiss(menu, anchor) {
  activeMenuAbortController?.abort();
  const controller = new AbortController();
  activeMenuAbortController = controller;
  setTimeout(() => {
    document.addEventListener("click", (event) => {
      if (!menu.contains(event.target) && event.target !== anchor) closeQuickReplies();
    }, { signal: controller.signal });
  }, 0);
}

async function openQuickReplies(anchor) {
  if (document.querySelector(".crmwa-qr-menu")) return closeQuickReplies();
  const composerContext = captureComposerContext();
  const menu = document.createElement("div");
  menu.className = "crmwa-qr-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Respostas rápidas");
  menu.textContent = "Carregando…";
  document.body.appendChild(menu);
  placeMenu(menu, anchor);
  registerMenuDismiss(menu, anchor);
  try {
    const { templates } = await send("quickReplies");
    menu.innerHTML = "";
    if (!templates.length) menu.textContent = "Nenhuma resposta rápida.";
    for (const t of templates) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "crmwa-qr-item";
      item.setAttribute("role", "menuitem");
      item.innerHTML = `<div class="crmwa-qr-title">${esc(t.title)}</div><div class="crmwa-qr-body">${esc(t.body)}</div>`;
      item.onclick = async (e) => {
        if (!e.isTrusted) return;
        if (!isComposerContextCurrent(composerContext)) {
          closeQuickReplies();
          return toast("A conversa mudou; abra novamente as respostas rápidas.");
        }
        const current = D.composerReadText(composerContext.element);
        const replaced = await replaceComposerTextSafely(t.body, current, composerContext);
        if (replaced.ok) closeQuickReplies();
        else if (replaced.reason === "restore_failed") toast(RESTORE_FAILED_MSG);
        else toast("Não consegui inserir a resposta rápida; o texto anterior foi preservado.");
      };
      menu.appendChild(item);
    }
  } catch (err) {
    menu.textContent = err.code === "NOT_CONFIGURED" ? "Configure a extensão nas opções." : err.message;
  }
}

// Menu genérico (reusa o estilo do menu de respostas). items: {title, active?, onClick}.
// O conteúdo é montado na abertura, então sempre reflete o estado atual (auto on/off).
function openMenu(anchor, items) {
  if (document.querySelector(".crmwa-qr-menu")) return closeQuickReplies();
  const menu = document.createElement("div");
  menu.className = "crmwa-qr-menu";
  menu.setAttribute("role", "menu");
  document.body.appendChild(menu);
  placeMenu(menu, anchor);
  for (const it of items) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "crmwa-qr-item" + (it.active ? " crmwa-qr-item-on" : "");
    el.setAttribute("role", "menuitem");
    el.innerHTML = `<div class="crmwa-qr-title">${esc(it.title)}</div>`;
    el.onclick = (e) => {
      // Itens traduzem, transcrevem ou mudam preferência: só clique do usuário.
      if (!e.isTrusted) return;
      closeQuickReplies();
      it.onClick(el);
    };
    menu.appendChild(el);
  }
  registerMenuDismiss(menu, anchor);
}

// Pontinho verde nos ícones quando o "auto" correspondente está ligado.
function refreshAutoButtons() {
  document
    .querySelector('[data-act="rx-menu"]')
    ?.classList.toggle("crmwa-on", autoTranscribe);
  document
    .querySelector('[data-act="tx-menu"]')
    ?.classList.toggle("crmwa-on", autoSendLang !== "off");
}

// ---------- Auto-traduzir ao enviar ----------

// Idioma salvo para a conversa atual (default off).
function applyChatAutoSend() {
  const value = autoSendByChat[currentChatKey];
  autoSendLang = value === "es" || value === "en" ? value : "off";
  refreshAutoButtons();
}

async function setAutoSend(lang) {
  if (!sessionScope) return toast("Faça login no CRM para alterar esta preferência.");
  const key = currentChatKey;
  if (!key) return toast("Ainda não identifiquei esta conversa. Tente de novo em instantes.");
  autoSendLang = lang;
  if (autoSendLang === "off") delete autoSendByChat[key];
  else autoSendByChat[key] = autoSendLang;
  const stored = await chrome.storage.local.get("autoSendByScopeChat");
  autoSendByScopeChat = { ...(stored.autoSendByScopeChat || {}), [sessionScope]: { ...autoSendByChat } };
  await chrome.storage.local.set({ autoSendByScopeChat });
  refreshAutoButtons();
  toast(
    autoSendLang === "off"
      ? "Auto-tradução ao enviar desligada nesta conversa."
      : `Nesta conversa, ao enviar será traduzido para ${autoSendLang === "es" ? "espanhol" : "inglês"}.`,
    false,
  );
}

// Dispara o envio real do WhatsApp. Nós engolimos o gesto do usuário (preventDefault),
// então a falha do clique NUNCA pode ser silenciosa: o texto fica no campo e avisamos.
function dispatchWhatsAppSend(fallbackMessage) {
  dispatchingSend = true;
  let sent = false;
  try {
    sent = D.clickSend();
  } finally {
    dispatchingSend = false;
  }
  if (!sent) toast(fallbackMessage);
}

// O usuário precisa saber ONDE a tradução parou: um "não funcionou" no texto da
// conversa e na legenda de um anexo têm causas diferentes.
function describeSendSurface(surface) {
  return surface === "caption" ? "A legenda" : "A mensagem";
}

async function doAutoSendTranslate(lang) {
  const surface = D.activeSendSurface();
  const subject = describeSendSurface(surface);
  const el = D.composer();
  const text = el ? (el.innerText || "").trim() : "";
  // Anexo sem legenda não tem o que traduzir: o interceptor nem engoliu o gesto.
  if (!text) return;
  // Extensão recarregada/atualizada com a aba aberta: o content script vira zumbi e
  // chrome.runtime some. Sem tradução não há envio — o original em PT nunca vaza.
  if (!chrome.runtime?.id) {
    return toast(`A extensão foi atualizada. Recarregue a página (F5) para voltar a traduzir. ${subject} não foi enviada.`);
  }
  const context = captureComposerContext();
  if (!isComposerContextCurrent(context)) {
    return toast(`Não consegui confirmar a conversa atual. ${subject} não foi enviada.`);
  }
  // Menção/conteúdo estruturado já foi tratado no interceptor (2º envio libera).
  autoSendBusy = true;
  try {
    const { translatedText } = await send("translate", { text, target: lang });
    if (!isComposerContextCurrent(context) || !U.isSameComposerText(D.composerReadText(context.element), text)) {
      return toast(`A conversa ou o texto mudou durante a tradução. ${subject} não foi enviada.`);
    }
    if (translatedText === null) {
      // Nada a traduzir (o texto já está no idioma alvo — "ok", "No", números, emoji…):
      // só o null EXPLÍCITO. O interceptor JÁ engoliu o gesto, então enviamos o ORIGINAL
      // na mão: "ok" é universal e não pode travar o envio.
      return dispatchWhatsAppSend("Nada a traduzir, mas não achei o botão de enviar. Aperte Enter para enviar.");
    }
    // Resposta sem o campo (ou vazia) não é "nada a traduzir": sem tradução, não envia.
    if (typeof translatedText !== "string" || !translatedText.trim()) {
      return toast(`A tradução voltou sem texto. ${subject} não foi enviada.`);
    }
    const replaced = await replaceComposerTextSafely(translatedText, text, context);
    if (!replaced.ok) {
      return toast(
        replaced.reason === "restore_failed"
          ? `${RESTORE_FAILED_MSG} ${subject} não foi enviada.`
          : `Não consegui substituir o texto com segurança. ${subject} foi preservada no original e não foi enviada.`
      );
    }
    if (!isComposerContextCurrent(context) || !U.isSameComposerText(D.composerReadText(context.element), translatedText)) {
      return toast(`A conversa mudou antes do envio. ${subject} não foi enviada.`);
    }
    dispatchWhatsAppSend("Traduzido, mas não achei o botão de enviar do WhatsApp. Aperte Enter para enviar.");
  } catch (err) {
    toast(`Tradução ao enviar falhou: ${err.message}. ${subject} não foi enviada.`);
  } finally {
    autoSendBusy = false;
  }
}

const isAutoLang = (value) => value === "en" || value === "es";

// Sem sessão confirmada vale qualquer escopo salvo: o login pode voltar com ele.
function autoSendPrefs() {
  return crmAuthState === "allowed" ? [autoSendByChat] : Object.values(autoSendByScopeChat || {});
}

function hasAnyAutoSend() {
  return autoSendPrefs().some((chats) => Object.values(chats || {}).some(isAutoLang));
}

// Idioma do auto-envio para ESTE envio: "en"/"es", "off", "wait" (preferências ou login
// carregando, conversa ainda sem chave) ou "no-session". Os dois últimos engolem o
// envio: na dúvida, o original em PT não sai.
function autoSendDecision() {
  if (!autoSendByScopeChat) return "wait";
  markPotentialChatChange(); // título trocou e o tick ainda não viu
  // Configuração vem da conversa VISÍVEL agora (marcador JID/telefone), nunca do título.
  const resolved =
    chatKeyResolved && D.mainComposer() === resolvedComposer && resolveVisibleChatKey() === currentChatKey;
  if (!resolved) return hasAnyAutoSend() ? "wait" : "off";
  const lang = autoSendPrefs().map((chats) => chats?.[currentChatKey]).find(isAutoLang);
  if (!lang) return "off";
  return crmAuthState === "allowed" ? lang : crmAuthState === "denied" ? "no-session" : "wait";
}

// Cobre as DUAS superfícies de envio com texto: o composer do rodapé e o composer de
// legenda do preview de mídia. `D.composer()`/`D.sendButton()` resolvem qual está ativa,
// então o fluxo abaixo (engolir gesto → traduzir → substituir → revalidar → enviar) vale
// para os dois sem duplicação. Anexo sem legenda não é interceptado: não há o que
// traduzir e o WhatsApp envia normalmente.
function interceptAutoSend(e, isEnter) {
  // O clique que NÓS disparamos em clickSend também borbulha até este listener de
  // captura. Sem esta linha, ele leva preventDefault/stopImmediatePropagation abaixo e o
  // WhatsApp nunca vê o clique — tradução fica no campo e a mensagem não envia.
  if (dispatchingSend) return;
  // Barato e cedo: sem nenhuma conversa com auto-envio, todo envio é do WhatsApp.
  if (autoSendByScopeChat && !hasAnyAutoSend()) return;
  if (isEnter) {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    if (!D.isComposer(e.target)) return;
    // Popup de menção/emoji aberto: este Enter SELECIONA a sugestão, não envia. Deixa o
    // WhatsApp tratar — traduzir agora pegaria a mensagem pela metade. O próximo Enter
    // (popup fechado) dispara a tradução + envio normalmente.
    if (D.isSuggestionOpen()) return;
  } else {
    const btn = D.sendButton();
    if (!btn || !(e.target === btn || btn.contains(e.target))) return;
  }
  const el = D.composer();
  const text = el ? (el.innerText || "").trim() : "";
  if (!text) return;
  const lang = autoSendDecision();
  if (lang === "off") return;
  const structured = isAutoLang(lang) && D.composerHasStructuredContent(el);
  const override = structuredSendOverride;
  structuredSendOverride = null;
  // Menção não é traduzida: 2º envio do USUÁRIO em até 5 s, mesma mensagem, sai o
  // original — o WhatsApp recebe o gesto normalmente.
  if (structured && e.isTrusted && !autoSendBusy && override?.element === el &&
      override.text === text && Date.now() < override.until) {
    return;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
  // Gesto sintético (script da página) nunca traduz nem envia.
  if (!e.isTrusted) return;
  const subject = describeSendSurface(D.activeSendSurface());
  if (lang === "wait") {
    return toast(`Auto-tradução desta conversa ainda carregando. ${subject} não foi enviada; aguarde e envie de novo.`);
  }
  if (lang === "no-session") {
    return toast(`Sem sessão do CRM não há auto-tradução. ${subject} não foi enviada; entre no CRM e envie de novo.`);
  }
  // Tradução em andamento: ENGOLE o gesto sem disparar outra tradução. Sem isto, o
  // segundo Enter passava direto pro WhatsApp e enviava o texto ORIGINAL junto com a
  // tradução (mensagem dupla PT+EN pro cliente).
  if (autoSendBusy) return toast("Traduzindo… aguarde, a mensagem sai sozinha.", false);
  if (structured) {
    structuredSendOverride = { element: el, text, until: Date.now() + 5000 };
    return toast(`${subject} tem menção ou chip e não é traduzida. Envie de novo em até 5 s para mandar sem tradução.`);
  }
  doAutoSendTranslate(lang);
}

document.addEventListener("keydown", (e) => interceptAutoSend(e, true), true);
document.addEventListener("click", (e) => interceptAutoSend(e, false), true);

function toggleAutoTranscribe() {
  if (!sessionScope) return toast("Faça login no CRM para alterar esta preferência.");
  autoTranscribe = !autoTranscribe;
  chrome.storage.local.get("autoTranscribeByScope").then((stored) => {
    const next = { ...(stored.autoTranscribeByScope || {}), [sessionScope]: autoTranscribe };
    chrome.storage.local.set({ autoTranscribeByScope: next });
  });
  refreshAutoButtons();
  if (autoTranscribe) {
    toast("Somente notas de voz recentes serão transcritas, uma por vez.", false);
    document.querySelectorAll(".crmwa-tr-btn-audio").forEach((btn) => {
      const bubble = btn.closest('#main div[role="row"]');
      if (bubble) enqueueAutoTranscription(bubble, btn);
    });
  } else {
    autoTranscriptionQueue.length = 0;
    autoTranscriptionQueuedIds.clear();
    toast("Transcrição automática desligada.", false);
  }
}

function ensureToolbar() {
  if (!hasCrm || crmAuthState !== "allowed") return;
  const footer = D.footer();
  if (!footer || footer.querySelector(".crmwa-toolbar")) return;
  if (!D.composer()) return;
  const bar = document.createElement("div");
  bar.className = "crmwa-toolbar";
  bar.innerHTML = `
    <span class="crmwa-tb-label">CRM</span>
    <button type="button" class="crmwa-tb-icon" data-act="rx-menu" title="Traduzir mensagens recebidas" aria-label="Traduzir mensagens recebidas">🌐</button>
    <button type="button" class="crmwa-tb-icon" data-act="tx-menu" title="Traduzir o rascunho agora" aria-label="Traduzir o rascunho agora">🔤</button>
    <button type="button" class="crmwa-tb-icon" data-act="qr" title="Respostas rápidas" aria-label="Abrir respostas rápidas">⚡</button>`;
  bar.querySelector('[data-act="rx-menu"]').onclick = (e) => {
    if (!e.isTrusted) return;
    openMenu(e.currentTarget, [
      { title: "🌐 Traduzir recebidas visíveis", onClick: (el) => translateAllVisible(el) },
      // Transcrição é via CRM/gateway — sem login no CRM a opção não existe.
      ...(hasCrm
        ? [
            {
              title: autoTranscribe
                ? "✓ Auto-transcrever notas de voz (ligado)"
                : "Auto-transcrever notas de voz",
              active: autoTranscribe,
              onClick: toggleAutoTranscribe,
            },
          ]
        : []),
    ]);
  };
  bar.querySelector('[data-act="tx-menu"]').onclick = (e) => {
    if (!e.isTrusted) return;
    openMenu(e.currentTarget, [
      { title: "Traduzir para Espanhol (agora)", onClick: (el) => translateComposer("es", el) },
      { title: "Traduzir para Inglês (agora)", onClick: (el) => translateComposer("en", el) },
      // Um item por idioma, em vez de um "alternar" que passava por off → EN → ES:
      // o usuário vê as duas opções e liga a que quer num clique. Clicar na já
      // ligada desliga.
      {
        title: autoSendLang === "en" ? "✓ Autoenviar em Inglês (ligado)" : "Autoenviar em Inglês",
        active: autoSendLang === "en",
        onClick: () => setAutoSend(autoSendLang === "en" ? "off" : "en"),
      },
      {
        title: autoSendLang === "es" ? "✓ Autoenviar em Espanhol (ligado)" : "Autoenviar em Espanhol",
        active: autoSendLang === "es",
        onClick: () => setAutoSend(autoSendLang === "es" ? "off" : "es"),
      },
      ...(autoSendLang === "off"
        ? []
        : [{ title: "Desligar autoenvio", onClick: () => setAutoSend("off") }]),
    ]);
  };
  bar.querySelector('[data-act="qr"]').onclick = (e) => {
    if (e.isTrusted) openQuickReplies(e.currentTarget);
  };
  footer.prepend(bar);
  refreshAutoButtons();
}

// ---------- Atalhos ----------

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const hadMenu = !!document.querySelector(".crmwa-qr-menu");
  const hadPanel = !!panelEl?.classList.contains("crmwa-open");
  if (!hadMenu && !hadPanel) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  closeQuickReplies();
  setPanelOpen(false);
}, true);

// ---------- Loop de observação ----------

let scheduled = false;
function tick() {
  scheduled = false;
  try {
    applyTheme();
    if (!D.main()) return; // sem conversa aberta, nada a fazer
    scheduleChatContextRefresh(0);
    ensureToolbar();
    rehydrateCachedTranscripts();
    addBubbleTranslateButtons();
    addBubbleEmailButtons();
  } catch {
    /* DOM em transição; próxima passada resolve */
  }
}

const observer = new MutationObserver((records) => {
  // A transcrição é nossa: mexer nela não pode agendar outro tick (era loop de ~10x/s).
  if (records.every((record) => record.target?.closest?.(".crmwa-panel,.crmwa-toolbar,.crmwa-qr-menu,.crmwa-toast,.crmwa-tr-transcript"))) {
    return;
  }
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => setTimeout(tick, 80));
});
observer.observe(document.querySelector("#app") || document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["title"],
});
tick();
