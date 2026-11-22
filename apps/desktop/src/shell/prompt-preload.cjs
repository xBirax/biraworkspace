const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("adrPrompt", {
  submit: (value, id) => ipcRenderer.invoke("shell:prompt-result", value, id),
});
