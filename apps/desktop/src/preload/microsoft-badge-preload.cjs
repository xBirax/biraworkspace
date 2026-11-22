// Outlook e Teams não põem as não lidas no título: avisam pela Badging API
// (navigator.setAppBadge / clearAppBadge). Registrado só na sessão das contas
// Microsoft (ver workspace-window): repassa o número ao app, que mostra no
// ícone da lateral e na barra de tarefas. Fora do Outlook/Teams não faz nada.
const HOMES =
  /^https:\/\/(outlook\.(office|office365|live)\.com|outlook\.cloud\.microsoft|teams\.(microsoft|live)\.com|teams\.cloud\.microsoft)$/;
if (window.top === window && HOMES.test(location.origin)) {
  const { contextBridge, ipcRenderer } = require("electron");
  const report = (count) => ipcRenderer.send("service:app-badge", count);
  contextBridge.executeInMainWorld({
    func: (send) => {
      // Não chama a função original: no Electron ela pinta o contador do app
      // inteiro na barra de tarefas, por cima do total que o app calcula.
      // Sem número é só "tem novidade": conta como 1.
      navigator.setAppBadge = (count) => {
        send(count === undefined ? 1 : Number(count));
        return Promise.resolve();
      };
      navigator.clearAppBadge = () => {
        send(0);
        return Promise.resolve();
      };
    },
    args: [report],
  });
  // O Outlook web numa aba comum nunca chama setAppBadge: as não lidas ficam no
  // title das pastas ("Caixa de Entrada - 9 itens (3 não lidos)"). Manda os
  // títulos crus quando mudam; o main acha a caixa de entrada e lê o número.
  if (location.hostname.startsWith("outlook.")) {
    let last = "";
    let pending = false;
    const sendFolders = () => {
      pending = false;
      const titles = [...document.querySelectorAll("[role=treeitem][title]")]
        .slice(0, 40)
        .map((node) => String(node.getAttribute("title")).slice(0, 200));
      const key = titles.join("\n");
      if (key === last) return;
      last = key;
      ipcRenderer.send("service:folder-titles", titles);
    };
    // Observador, não intervalo: timer de página oculta é segurado pelo Chromium.
    new MutationObserver(() => {
      if (pending) return;
      pending = true;
      setTimeout(sendFolders, 1000);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
  }
}
