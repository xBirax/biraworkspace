const { contextBridge, ipcRenderer } = require("electron");

// Janela do histórico do ADR Browser (Ctrl+H). Só estes canais; o main só os
// atende para esta janela (handleHistory em workspace-window.ts).
contextBridge.exposeInMainWorld("adrHistory", {
  search: (query) => ipcRenderer.invoke("history:search", String(query || "")),
  remove: (url) => ipcRenderer.invoke("history:remove", String(url || "")),
  clear: () => ipcRenderer.invoke("history:clear"),
  open: (url) => ipcRenderer.invoke("history:open", String(url || "")),
  getAppearance: () => ipcRenderer.invoke("history:get-appearance"),
  onChanged: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("history:changed", listener);
    return () => ipcRenderer.removeListener("history:changed", listener);
  },
});
