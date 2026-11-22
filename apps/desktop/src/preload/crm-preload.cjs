const { contextBridge, ipcRenderer } = require("electron");

/** Must match desktopCrmCommandSchema / CRM_PRELOAD_METHODS in @adr/crm-desktop-adapter. */
const ALLOWED_COMMANDS = new Set([
  "whoami",
  "lookup",
  "getChatIdentity",
  "translate",
  "transcribeMessage",
  "quickReplies",
  "getTranscriptCache",
  "cacheTranscript",
  "saveGoogleContact",
  "scheduleMeeting",
  "openCrm",
  "openSettings",
  "openOptions",
  "ping",
]);

function invoke(command, payload) {
  if (typeof command !== "string" || !ALLOWED_COMMANDS.has(command)) {
    return Promise.resolve({
      ok: false,
      code: "INVALID_REQUEST",
      message: "Comando CRM inválido.",
      error: "Comando CRM inválido.",
    });
  }
  return ipcRenderer.invoke("crm:invoke", command, payload && typeof payload === "object" ? payload : {});
}

/**
 * Mundo isolado, não o da página: no mundo principal qualquer script do
 * WhatsApp Web (conteúdo de terceiro) chamava `adrCrm.lookup` em loop e copiava
 * contatos e negócios do CRM. O painel (content.js) e o botão do cabeçalho são
 * injetados neste mesmo mundo — como content script de extensão no Chrome.
 * Tem de bater com CRM_WORLD_ID em main/whatsapp-inject.ts.
 */
const CRM_WORLD_ID = 1030;

contextBridge.exposeInIsolatedWorld(CRM_WORLD_ID, "adrCrm", {
  invoke,
  whoami: () => invoke("whoami", {}),
  lookup: (payload) => invoke("lookup", payload || {}),
  getChatIdentity: () => invoke("getChatIdentity", {}),
  translate: (payload) => invoke("translate", payload || {}),
  transcribeMessage: (payload) => invoke("transcribeMessage", payload || {}),
  quickReplies: (payload) => invoke("quickReplies", payload || {}),
  getTranscriptCache: (payload) => invoke("getTranscriptCache", payload || {}),
  cacheTranscript: (payload) => invoke("cacheTranscript", payload || {}),
  saveGoogleContact: (payload) => invoke("saveGoogleContact", payload || {}),
  scheduleMeeting: (payload) => invoke("scheduleMeeting", payload || {}),
  openCrm: (payload) => invoke("openCrm", payload || {}),
  openSettings: () => invoke("openSettings", {}),
  openOptions: () => invoke("openOptions", {}),
  ping: () => invoke("ping", {}),
});
