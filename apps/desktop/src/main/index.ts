import {
  app,
  BaseWindow,
  crashReporter,
  dialog,
  components,
  ipcMain,
  Menu,
  nativeTheme,
  session,
  type WebContents,
  type WebFrameMain,
  type Session,
} from "electron";
import path from "node:path";
import {
  assertPersonalCrmSession,
  buildPersonalCrmHeaders,
  whoamiFromAuthMeApi,
  whoamiFromError,
  whoamiFromSessionApi,
  CHAT_IDENTITY_PROBE,
  wrapChatIdentityResult,
  sanitizeLookupResult,
  normalizeQuickRepliesPayload,
  normalizeTranscribeResult,
  normalizeAllowedBaseUrl,
  type CrmPanelKillSwitch,
} from "@adr/crm-core";
import {
  validateComposerTranslateRequest,
  validateCrmIpcRequest,
  viewKindAllowsCrmPreload,
} from "@adr/crm-desktop-adapter";
import { crmLoginPartition } from "./crm-login.js";
import { createWorkspaceWindow, type ViewKind } from "./workspace-window.js";
import { CrmTranscriptCache } from "./crm-transcript-cache.js";
import { backupBeforeElectron44 } from "./runtime-profile-backup.js";
import { backupInProgress, backupsDirectory, readBackupStatus } from "./profile-backup.js";
import { isCrmHandoffPath } from "./whatsapp-inject.js";
import { runGmailCommand } from "./gmail-commands.js";

const mainDir = path.join(app.getAppPath(), "dist", "main");
const CRM_URL = "https://app.adragencia.com.br/";

app.setName("BiraWorkspace");
// Keep `pnpm dev` off the installed app's profile. Both resolve userData from
// the app name, so without this they share state.v1.json, the vault and every
// session partition — two running instances then race on the same state file.
// Must come before anything reads app.getPath("userData").
if (!app.isPackaged) {
  app.setPath("userData", `${app.getPath("userData")} Dev`);
}
// Crash nativo do Chromium (o 0xc0000005 da Chrome Web Store, 16/10) fechava o
// app sem deixar rastro: só o Visualizador de Eventos dizia que houve crash.
// Com isto o minidump fica em <userData>/Crashpad/reports. Só local: nada é
// enviado (uploadToServer false), e o dump não sai da máquina sem alguém copiá-lo.
crashReporter.start({ uploadToServer: false });
// `app.exit` não interrompe este módulo: o resto do boot síncrono continua
// rodando. Quem perdeu o lock não pode copiar o perfil nem abrir a janela.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) app.exit(0);
app.on("second-instance", () => {
  const window = BaseWindow.getAllWindows()[0];
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
});
// Complete the copy before any session or application state is opened.
if (isPrimaryInstance && app.isPackaged) {
  try {
    backupBeforeElectron44(app.getPath("userData"));
  } catch {
    dialog.showErrorBox(
      "Atualização do BiraWorkspace",
      "Não foi possível criar a cópia local das sessões. O aplicativo será fechado para preservar seus dados. Verifique o espaço livre e as permissões da pasta de dados e tente novamente.",
    );
    app.exit(1);
  }
}
if (process.platform === "linux") {
  app.commandLine.appendSwitch("class", "ADRWorkspace");
}
if (process.platform === "win32") {
  // Without this, Windows has no registered identity for the app and toast
  // notifications fall back to a synthetic "electron.app.<productName>" label
  // instead of "BiraWorkspace". Must match the NSIS installer's appId
  // (package.json build.appId) so the Start Menu shortcut's AUMID lines up.
  app.setAppUserModelId("br.com.adragencia.workspace");
}
// Match Ubuntu/Linux dark chrome on Windows until settings load.
nativeTheme.themeSource = "dark";
// A política padrão do Chromium exige ativação do usuário POR DOCUMENTO para
// soltar o AudioContext. Dentro de uma WebContentsView o clique nem sempre conta
// como ativação (a view não é a janela focada do ponto de vista do Blink), e o
// sintoma é exatamente este: o botão de play responde, a UI anima, sai sem som.
// Aqui só abrimos serviços escolhidos pelo usuário — nenhum deles é um site
// aleatório com autoplay indesejado.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// O teto de heap V8 (`--max-old-space-size`) saiu daqui. Ele valia para TODO
// renderer, e o argumento que o justificava se derrubava sozinho: um teto não faz
// a página usar menos memória, só mata o renderer quando ela precisa de mais. Em
// 256 o sintoma era "aba do CRM em tela preta"; em 512 virou o CRM caindo com
// `render-process-gone reason=oom` — e, na recaída dentro de 30 s, a aba parando
// no cartão de erro. Isto é o "o CRM trava às vezes" / "não abre".
// A economia real de RAM vem da hibernação e da visibilidade das views (ver
// `place` em workspace-window), não de um limite arbitrário no maior renderer
// do app. O cache de disco continua com teto: esse não mata nada.
app.commandLine.appendSwitch("disk-cache-size", "104857600"); // 100MB
// O Chromium mantém um renderer vazio aquecido o tempo todo para a PRÓXIMA
// navegação. Aqui as views são fixas e de vida longa — trocar de aba não cria
// processo —, então esse sobressalente é um processo residente que nunca paga
// o que custa. Uma única chamada: appendSwitch com a mesma chave sobrescreve,
// então qualquer feature nova a desligar entra nesta lista.
app.commandLine.appendSwitch("disable-features", "SpareRendererForSitePerProcess");
/**
 * `webContents.loadURL()` REJEITA quando o load falha, e nenhuma das ~15 chamadas
 * espalhadas pela janela trata isso — `void` cala o lint, não a rejeição. Sem este
 * handler o Node encerra o processo no primeiro tropeço de rede ao abrir o CRM, e
 * o sintoma é o app inteiro sumindo sem nada no diagnóstico.
 *
 * Uma guarda no lugar por onde todas passam, em vez de 15 `.catch(() => undefined)`
 * que ainda por cima engoliriam o motivo.
 */
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection", reason);
});

/**
 * Depois do before-quit, erro em tratador de evento (aba sendo destruída, som
 * parando no meio do fechamento) não tem mais consequência para o usuário — e o
 * diálogo padrão do Electron segurava o processo até o clique em OK, no meio da
 * saída ou da instalação de uma atualização. Fora do fechamento o diálogo
 * continua, igual ao padrão, para não esconder bug real.
 */
let appQuitting = false;
process.on("uncaughtException", (error) => {
  console.error(appQuitting ? "uncaughtException durante o fechamento" : "uncaughtException", error);
  if (appQuitting) return;
  dialog.showErrorBox(
    "A JavaScript error occurred in the main process",
    `Uncaught Exception:\n${error?.stack || String(error)}`,
  );
});

const viewMeta = new WeakMap<
  WebContents,
  { kind: ViewKind; workspaceId: string; serviceId?: string }
>();
const transcriptCache = new CrmTranscriptCache(whoamiForWorkspace);
const watchedCrmSessions = new WeakSet<Session>();
let showCrmSurface: ((path?: string, workspaceId?: string) => void) | null = null;
let scheduleMeeting:
  | ((payload: { name?: unknown; phone?: unknown }) => Promise<{ opened: true }>)
  | null = null;
let saveGoogleContact:
  | ((payload: {
      name?: unknown;
      phone?: unknown;
    }) => Promise<{ opened: true; name: string | null }>)
  | null = null;
let crmPanelKillSwitch: CrmPanelKillSwitch = { enabled: true };
let flushSessions: (() => Promise<void>) | null = null;

function crmPartition(workspaceId: string): string {
  const partition = crmLoginPartition(workspaceId);
  const ses = session.fromPartition(partition);
  if (!watchedCrmSessions.has(ses)) {
    watchedCrmSessions.add(ses);
    ses.cookies.on("changed", (_event, cookie) => {
      if (["auth_token", "tenant_id", "adr_impersonation_session"].includes(cookie.name)) {
        transcriptCache.invalidate(workspaceId);
      }
    });
  }
  return partition;
}

async function readCookie(partitionName: string, baseUrl: string, name: string): Promise<string> {
  const ses = session.fromPartition(partitionName);
  const cookie = await ses.cookies.get({ url: baseUrl, name });
  return cookie[0]?.value || "";
}

const CRM_TIMEOUT_MESSAGE = "A consulta ao CRM demorou demais. Tente novamente.";

function isTimeoutError(error: unknown): boolean {
  const name = (error as Error)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * O TimeoutError do AbortSignal vem em inglês ("The operation was aborted due
 * to timeout") e chegava assim ao card da Lusha e aos painéis. Convertido aqui,
 * vale para todo chamador; o `name` continua TimeoutError.
 */
function crmTimeoutError(error: unknown): unknown {
  if (!isTimeoutError(error)) return error;
  return Object.assign(new Error(CRM_TIMEOUT_MESSAGE), { name: "TimeoutError" });
}

async function callCrmJson(
  workspaceId: string,
  apiPath: string,
  init: RequestInit = {},
): Promise<unknown> {
  const baseUrl = normalizeAllowedBaseUrl(CRM_URL, { allowLocalhost: !app.isPackaged });
  const partitionName = crmPartition(workspaceId);
  const token = await readCookie(partitionName, baseUrl, "auth_token");
  const tenantId = await readCookie(partitionName, baseUrl, "tenant_id");
  const impersonationSession = await readCookie(
    partitionName,
    baseUrl,
    "adr_impersonation_session",
  );
  const cookies: {
    auth_token?: string;
    tenant_id?: string;
    adr_impersonation_session?: string;
  } = {};
  if (token) cookies.auth_token = token;
  if (tenantId) cookies.tenant_id = tenantId;
  if (impersonationSession) cookies.adr_impersonation_session = impersonationSession;
  const auth = assertPersonalCrmSession(cookies);
  const headers = new Headers(init.headers || {});
  for (const [key, value] of Object.entries(buildPersonalCrmHeaders(auth))) {
    headers.set(key, value);
  }
  // Teto padrão: sem ele, o lookup do painel, as respostas rápidas e a Lusha
  // esperavam para sempre numa rede travada. Quem precisa de mais (transcrição,
  // 180 s; assistente do Gmail, 45 s) passa o próprio signal.
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${apiPath}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw crmTimeoutError(error);
  }
  const data = await res.json().catch((error: unknown) => {
    // Corpo ilegível vira {}; corpo cortado pelo timeout NÃO — senão uma consulta
    // lenta voltava como sucesso vazio ("nenhum contato encontrado").
    if (isTimeoutError(error)) throw crmTimeoutError(error);
    return {};
  });
  if (!res.ok) {
    // 403 de negócios ou da Lusha é falta de permissão NAQUELE recurso, não
    // sessão perdida: só 401, ou 403 das rotas do WhatsApp (de onde vêm as
    // transcrições), derrubam o cache.
    if (res.status === 401 || (res.status === 403 && apiPath.startsWith("/api/whatsapp/"))) {
      transcriptCache.invalidate(workspaceId);
    }
    const err = new Error(
      typeof data === "object" && data && "error" in data
        ? String((data as { error?: string }).error)
        : `Erro ${res.status}`,
    );
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return data;
}

async function whoamiForWorkspace(workspaceId: string) {
  try {
    try {
      const data = (await callCrmJson(workspaceId, "/api/whatsapp/app/session", {
        signal: AbortSignal.timeout(20_000),
      })) as {
        context?: { userId?: string; tenantId?: string };
      };
      return whoamiFromSessionApi(data);
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
      const tenantId = await readCookie(crmPartition(workspaceId), CRM_URL, "tenant_id");
      const data = (await callCrmJson(workspaceId, "/api/auth/me", {
        signal: AbortSignal.timeout(20_000),
      })) as {
        user?: { id?: string; tenant?: { id?: string } };
      };
      return whoamiFromAuthMeApi(data, tenantId);
    }
  } catch (error) {
    const mapped = whoamiFromError(error);
    if (mapped) return mapped;
    throw error;
  }
}

async function translateForWorkspace(workspaceId: string, text: string, target: string) {
  const data = (await callCrmJson(workspaceId, "/api/whatsapp/app/translate-text", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, targetLanguage: target }),
    // Teto aqui, e não em cada chamador: Gmail, WhatsApp e o tradutor dos
    // serviços passam todos por esta função, e sem ele um fetch travado deixava
    // o botão de traduzir desabilitado para sempre.
    signal: AbortSignal.timeout(45_000),
  })) as { translatedText?: string | null; sourceLanguage?: string };
  // `translatedText: null` é "já está no idioma" (o envio automático manda o
  // original). Campo AUSENTE é resposta quebrada: tratada como null, fazia o
  // português sair numa conversa com tradução automática ligada.
  if (!data || typeof data !== "object" || !("translatedText" in data)) {
    throw new Error("Resposta de tradução inválida. Tente novamente.");
  }
  return {
    translatedText: data.translatedText || null,
    sourceLanguage: data?.sourceLanguage,
  };
}

async function handleGmailCommand(
  command: string,
  payload: unknown,
  sender: WebContents,
  frame?: WebFrameMain | null,
): Promise<unknown> {
  // Aqui só a origem; o formato do pedido é validado (e testado) em runGmailCommand.
  const meta = viewMeta.get(sender);
  const url = frame?.url || sender.getURL();
  if (meta?.kind !== "gmail" || !frame || frame !== sender.mainFrame ||
      !url.startsWith("https://mail.google.com/mail/")) {
    throw new Error("Origem Gmail não autorizada.");
  }
  const workspaceId = meta.workspaceId || "default";
  return runGmailCommand(command, payload, {
    callCrm: (apiPath, init) => callCrmJson(workspaceId, apiPath, init),
    translate: (text, target) => translateForWorkspace(workspaceId, text, target),
    openCrm: () => showCrmSurface?.(undefined, workspaceId),
  });
}

async function handleCrmCommand(
  command: string,
  payload: Record<string, unknown>,
  sender: WebContents,
  senderFrame?: WebFrameMain | null,
): Promise<unknown> {
  const meta = viewMeta.get(sender);
  // `frameIsMain: true` era constante, e com isso a trava de subframe do
  // ipc-guard nunca disparava. `sender.getURL()` também é do frame de topo: um
  // iframe passaria na checagem de origem usando a URL de quem o hospeda.
  const validation = validateCrmIpcRequest(command, {
    // Frame nulo (navegou ou morreu antes de o handler ler) não é frame de topo:
    // aceitá-lo julgava o pedido pela URL da página que estiver na view AGORA.
    url: senderFrame?.url || "",
    frameIsMain: Boolean(senderFrame) && senderFrame === sender.mainFrame,
    isWhatsAppInstance: viewKindAllowsCrmPreload(meta?.kind || ""),
  });
  if (!validation.ok) {
    const err = new Error(validation.message);
    (err as Error & { code?: string }).code = validation.code;
    throw err;
  }

  const workspaceId = meta?.workspaceId || "default";

  switch (validation.command) {
    case "whoami": {
      return whoamiForWorkspace(workspaceId);
    }
    case "lookup": {
      const phone = String(payload["phone"] || "").replace(/\D/g, "");
      const name = String(payload["name"] || "").trim();
      const contactsById = new Map<string, Record<string, unknown>>();

      if (phone) {
        const data = (await callCrmJson(
          workspaceId,
          `/api/crm/contacts?phone=${encodeURIComponent(phone)}&limit=5`,
        )) as { items?: Record<string, unknown>[] };
        for (const c of data?.items || []) {
          if (c["id"]) contactsById.set(String(c["id"]), c);
        }
      } else if (name) {
        const terms = [
          ...new Set(
            [name, ...name.split(/[|\-–—•·/]+/).map((s) => s.trim())].filter((t) => t.length >= 3),
          ),
        ].slice(0, 4);
        await Promise.all(
          terms.map(async (term) => {
            const data = (await callCrmJson(
              workspaceId,
              `/api/crm/contacts?search=${encodeURIComponent(term)}&limit=25`,
            )) as { items?: Record<string, unknown>[] };
            for (const c of data?.items || []) {
              if (c["id"]) contactsById.set(String(c["id"]), c);
            }
          }),
        );
      }

      const contacts = [...contactsById.values()].slice(0, 8);
      const contactIds = contacts
        .map((c) => String(c["id"]))
        .filter(Boolean)
        .slice(0, 3);
      const companyIds = [
        ...new Set(
          contacts
            .map((c) => {
              const company = c["company"] as { id?: string } | null | undefined;
              return company?.id ? String(company.id) : "";
            })
            .filter(Boolean),
        ),
      ].slice(0, 2);

      const dealsById = new Map<string, Record<string, unknown>>();
      const addDeals = (data: { items?: Record<string, unknown>[] }) => {
        for (const deal of data?.items || []) {
          if (deal["id"]) dealsById.set(String(deal["id"]), deal);
        }
      };

      const dealQueries: Promise<void>[] = [];
      for (const cid of contactIds) {
        dealQueries.push(
          callCrmJson(
            workspaceId,
            `/api/crm/deals?contactId=${encodeURIComponent(cid)}&pageSize=10`,
          ).then((d) =>
            addDeals(d as { items?: Record<string, unknown>[] }),
          ),
        );
      }
      for (const companyId of companyIds) {
        dealQueries.push(
          callCrmJson(
            workspaceId,
            `/api/crm/deals?companyId=${encodeURIComponent(companyId)}&pageSize=10`,
          ).then((d) =>
            addDeals(d as { items?: Record<string, unknown>[] }),
          ),
        );
      }
      // Sem permissão de negócios (403) a busca ainda devolve os contatos, como no
      // painel do Gmail; antes um 403 derrubava a consulta inteira.
      await Promise.all(
        dealQueries.map((query) =>
          query.catch((error: unknown) => {
            if ((error as { status?: number }).status !== 403) throw error;
          }),
        ),
      );

      return sanitizeLookupResult({
        contacts: contacts.map((contact) => ({
          id: contact["id"],
          name: contact["name"],
          number: contact["number"],
          phone: contact["phone"],
          company: contact["company"]
            ? {
                id: (contact["company"] as { id?: string }).id,
                number: (contact["company"] as { number?: string }).number,
                name: (contact["company"] as { name?: string }).name,
              }
            : null,
        })),
        deals: [...dealsById.values()].slice(0, 15).map((deal) => ({
          id: deal["id"],
          number: deal["number"],
          title: deal["title"],
          status: deal["status"],
          valueCents: deal["valueCents"],
          currency: deal["currency"],
          ownerDisplayName: deal["ownerDisplayName"],
          stage: deal["stage"] ? { name: (deal["stage"] as { name?: string }).name } : null,
        })),
        projects: [],
        warnings: [],
      });
    }
    case "getChatIdentity": {
      const result = await sender.executeJavaScript(CHAT_IDENTITY_PROBE, true);
      return wrapChatIdentityResult(result);
    }
    case "translate": {
      const text = String(payload["text"] || "");
      const target = String(payload["target"] || "pt-BR");
      return translateForWorkspace(workspaceId, text, target);
    }
    case "transcribeMessage": {
      const externalId = String(payload["externalId"] || "");
      // `encodeURIComponent("..")` é ".." mesmo: o POST autenticado subia um
      // nível e ia para outra rota do CRM, escolhida pela página.
      if (!externalId || externalId === "." || externalId === "..") {
        throw Object.assign(new Error("Mensagem inválida."), { code: "INVALID_INPUT" });
      }
      const remoteJid = String(payload["remoteJid"] || "");
      // The CRM is the canonical cache and must authorize every transcription.
      // The UI hydration cache below never bypasses this request.
      // Sem try/catch: o erro precisa SUBIR com o status HTTP. Áudio recém-chegado
      // ainda não foi ingerido no CRM e responde 404 — o content script espera até
      // 2 min por esse 404 antes de desistir. Transformar tudo em
      // `{status:"failed"}` aqui apagava o status e essa espera nunca acontecia:
      // a primeira nota de voz de uma conversa falhava na hora.
      const data = await callCrmJson(
        workspaceId,
        `/api/whatsapp/app/messages/${encodeURIComponent(externalId)}/transcription`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ remoteJid }),
          signal: AbortSignal.timeout(180_000),
        },
      );
      const normalized = normalizeTranscribeResult(data);
      if (normalized.status === "done") {
        return { status: "completed", text: normalized.text, error: null };
      }
      // "pending" é o estado que o content script pollea; "failed" encerrava.
      if (normalized.status === "loading") return { status: "pending", text: null, error: null };
      return {
        status: "failed",
        text: null,
        error: normalized.status === "error" ? normalized.message : "transcrição indisponível",
      };
    }
    case "quickReplies": {
      const data = await callCrmJson(workspaceId, "/api/whatsapp/app/quick-replies");
      return normalizeQuickRepliesPayload(data);
    }
    case "getTranscriptCache": {
      const scope = String(payload["scope"] || "").trim();
      return transcriptCache.read(workspaceId, scope);
    }
    case "cacheTranscript": {
      const scope = String(payload["scope"] || "").trim();
      const externalId = String(payload["externalId"] || "").trim();
      const text = String(payload["text"] || "").trim();
      return transcriptCache.write(workspaceId, scope, externalId, text);
    }
    case "saveGoogleContact": {
      if (!saveGoogleContact) throw new Error("Janela não inicializada.");
      return saveGoogleContact({ name: payload["name"], phone: payload["phone"] });
    }
    case "scheduleMeeting": {
      if (!scheduleMeeting) throw new Error("Janela não inicializada.");
      return scheduleMeeting({ name: payload["name"], phone: payload["phone"] });
    }
    case "openCrm": {
      // `path` opcional (ex.: o handoff de vincular pessoa a negócio). Quem chama
      // é a página do WhatsApp: só as rotas de handoff passam (isCrmHandoffPath).
      const path = typeof payload["path"] === "string" ? payload["path"] : "";
      if (path && !isCrmHandoffPath(path)) throw new Error("Caminho do CRM não permitido.");
      showCrmSurface?.(path || undefined, workspaceId);
      return {};
    }
    case "openSettings":
    case "openOptions": {
      showCrmSurface?.(undefined, workspaceId);
      return {};
    }
    case "ping": {
      await callCrmJson(workspaceId, "/api/crm/contacts?limit=1");
      return { message: `Conectado: ${CRM_URL}` };
    }
    default:
      throw new Error("Comando CRM não suportado.");
  }
}

/**
 * CastLabs ECS: o CDM do Widevine é um componente baixado sob demanda. Sem
 * esperar por ele, a instalação só acontece num timer com atraso — o Spotify
 * pede DRM antes disso e falha em silêncio. `components` não existe no Electron
 * padrão (chamada opcional), e o timeout evita que um download travado impeça
 * o app de abrir: pior um Spotify mudo do que uma janela que nunca aparece.
 */
async function installWidevine(): Promise<void> {
  if (!components?.whenReady) return;
  try {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      components.whenReady(),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 25_000);
      }),
    ]);
    clearTimeout(timer);
    console.log("widevine components", JSON.stringify(components.status?.() ?? {}));
  } catch (error) {
    console.error("widevine components falhou", error);
  }
}

/** Mensagem de erro para a UI (timeout cru, se escapar do callCrmJson, sai em português). */
function ipcErrorMessage(error: unknown): string {
  const mapped = crmTimeoutError(error) as Error;
  return String(mapped?.message || error);
}

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return;
  // Cópia do perfil em andamento (backup-profile.ps1, do instalador ou do
  // "Fazer backup agora"): abrir agora faria o robocopy pegar arquivos presos e
  // a cópia sair incompleta. Pergunta antes de abrir as sessões.
  if (app.isPackaged && backupInProgress(readBackupStatus(backupsDirectory(app.getPath("userData"))))) {
    const { response } = await dialog.showMessageBox({
      type: "warning",
      buttons: ["Fechar e aguardar", "Abrir mesmo assim"],
      defaultId: 0,
      cancelId: 0,
      title: "BiraWorkspace",
      message: "Um backup do perfil está em andamento.",
      detail:
        "O backup manual reabre o app sozinho quando termina; o da atualização leva alguns minutos. Abrir agora pode deixar a cópia incompleta.",
    });
    if (response === 0) {
      app.exit(0);
      return;
    }
  }
  await installWidevine();
  // Hide empty Electron menu bar (Windows) — Linux CSD already looks clean.
  Menu.setApplicationMenu(null);
  ipcMain.handle("gmail:invoke", async (event, command: string, payload: Record<string, unknown> = {}) => {
    try {
      const data = await handleGmailCommand(command, payload, event.sender, event.senderFrame);
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: ipcErrorMessage(error) };
    }
  });
  ipcMain.handle(
    "crm:invoke",
    async (event, command: string, payload: Record<string, unknown> = {}) => {
      try {
        const data = await handleCrmCommand(command, payload, event.sender, event.senderFrame);
        return { ok: true, data };
      } catch (error) {
        // `status` vai junto: o content script decide esperar (404 = ainda não
        // ingerido) ou derrubar a sessão (401/403) a partir dele. Sem isto o
        // shim entregava um erro sem status e todo caminho de retry virava
        // falha imediata.
        return {
          ok: false,
          code: (error as { code?: string }).code || "UPSTREAM_ERROR",
          status: (error as { status?: number }).status,
          message: ipcErrorMessage(error),
          error: ipcErrorMessage(error),
        };
      }
    },
  );
  ipcMain.handle("composer:translate", async (event, payload: unknown) => {
    try {
      const meta = viewMeta.get(event.sender);
      const validation = validateComposerTranslateRequest(payload, {
        kind: meta?.kind || "",
        url: event.senderFrame?.url || "",
        frameIsMain: Boolean(event.senderFrame) && event.senderFrame === event.sender.mainFrame,
      });
      if (!validation.ok) return validation;
      const data = await translateForWorkspace(
        meta?.workspaceId || "default",
        validation.payload.text,
        validation.payload.target,
      );
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        code: (error as { code?: string }).code || "UPSTREAM_ERROR",
        message: ipcErrorMessage(error),
      };
    }
  });
  createWorkspaceWindow({
    dirname: mainDir,
    viewMeta,
    invalidateCrmSession: (workspaceId) => transcriptCache.invalidate(workspaceId),
    callCrmJson,
    setShowCrmSurface: (fn) => {
      showCrmSurface = fn;
    },
    setSaveGoogleContact: (fn) => {
      saveGoogleContact = fn;
    },
    setScheduleMeeting: (fn) => {
      scheduleMeeting = fn;
    },
    getCrmPanelKillSwitch: () => crmPanelKillSwitch,
    setCrmPanelKillSwitch: (next) => {
      crmPanelKillSwitch = next;
    },
    setFlushSessions: (fn) => {
      flushSessions = fn;
    },
  });
}).catch((error: unknown) => {
  // Sem isto o boot falho deixava o processo vivo, sem janela e com o lock de
  // instância única: cada clique no ícone caía no second-instance e nada abria.
  console.error("falha ao abrir a janela", error);
  dialog.showErrorBox(
    "BiraWorkspace",
    `Não foi possível abrir o BiraWorkspace.

${error instanceof Error ? error.message : String(error)}`,
  );
  app.exit(1);
});

/**
 * O Chromium só grava cookie em disco de tempos em tempos; fechar o app antes
 * dessa gravação perde o login feito na sessão (sintoma: Spotify pedindo login
 * toda vez que o programa abre, mas não depois de um update — o caminho do
 * update já fazia esse flush). Aqui vale para qualquer saída pelo app; reiniciar
 * o Windows não passa por aqui e é tratado no session-end da janela.
 *
 * A lista de sessões vem da janela (flushSessions), que enxerga as partições —
 * serviço hibernado não tem webContents e ficava de fora.
 */
let flushingBeforeQuit = false;
app.on("before-quit", (event) => {
  appQuitting = true;
  if (flushingBeforeQuit || !flushSessions) return;
  flushingBeforeQuit = true;
  event.preventDefault();
  // Teto de 3s. Este handler CANCELA o quit e promete recolocá-lo; se um
  // flushStore travar, o app simplesmente nunca fecha — e quem pediu o fechamento
  // fica sem resposta. Vale para o X da janela e, principalmente, para o quit que
  // o updater dispara ao instalar: lá o sintoma é "cliquei em Instalar e não
  // aconteceu nada". Cookie não gravado custa um login; não fechar custa o app.
  const quit = (): void => app.quit();
  void Promise.race([flushSessions(), new Promise((resolve) => setTimeout(resolve, 3000))]).then(
    quit,
    quit,
  );
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
