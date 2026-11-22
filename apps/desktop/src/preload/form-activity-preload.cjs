// Executa antes dos scripts da página; guarda referências fracas, nunca o texto digitado.
(() => {
  const { contextBridge } = require("electron");
  const dirty = new WeakSet();
  const mark = (event) => {
    const field = event.target?.closest?.("[contenteditable]");
    if (field?.isContentEditable) dirty.add(field);
  };
  document.addEventListener("input", mark, true);
  document.addEventListener("change", mark, true);
  contextBridge.exposeInMainWorld("__adrFormActivity", {
    hasEdits: () => [...document.querySelectorAll("[contenteditable]")].some((field) =>
      dirty.has(field) && field.isConnected && String(field.innerText || field.textContent || "").trim()),
  });
})();
