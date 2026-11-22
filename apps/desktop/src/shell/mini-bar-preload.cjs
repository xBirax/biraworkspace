const { contextBridge, ipcRenderer } = require("electron");

/**
 * Barra da mini-janela do Meet: só "abrir a reunião" e "ocultar". O main confere
 * que o pedido vem desta view e da página do shell (guardedHandle).
 */
contextBridge.exposeInMainWorld("adrMini", {
  expand: () => ipcRenderer.invoke("mini:action", "expand"),
  hide: () => ipcRenderer.invoke("mini:action", "hide"),
});
