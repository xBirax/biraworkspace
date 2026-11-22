// Login (Google, Apple, Microsoft) usa a página nativa, sem o overlay do composer:
// o popup de login herda o preload da aba que o abriu.
if (
  ![
    "https://accounts.google.com",
    "https://appleid.apple.com",
    "https://login.microsoftonline.com",
    "https://login.microsoft.com",
    "https://login.live.com",
    "https://account.live.com",
  ].includes(location.origin)
) {
  const { ipcRenderer } = require("electron");

  const EDITABLE = 'textarea, input[type="text"], input[type="search"], [contenteditable="true"]';
  // Além de texto e quebras de linha (br/div/p/span), tudo o que a tradução
  // apagaria: links, imagens, menções (contenteditable=false), listas, negrito.
  const RICH = ':not(br, div, p, span), [contenteditable="false"]';
  let editor = null;
  let busy = false;
  // Editor + texto em que o usuário já aceitou perder a formatação (2º clique).
  let confirmedRich = null;
  // "×" fecha neste campo (outro campo traz de volta); "–" deixa só o ícone,
  // que reabre a barra.
  let dismissedEditor = null;

  function editableFrom(target) {
    const element = target instanceof Element ? target.closest(EDITABLE) : null;
    if (!element || element.disabled || element.readOnly) return null;
    return element;
  }

  function readText(element) {
    return "value" in element ? element.value : element.innerText || "";
  }

  function writeText(element, text) {
    element.focus();
    if ("value" in element) {
      const prototype =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, text);
      element.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }),
      );
      return true;
    }
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    // Sem fallback por textContent: ele apagava o conteúdo rico de vez e sem
    // desfazer (Ctrl+Z não alcança). Falhou, o rascunho fica como estava.
    return document.execCommand("insertText", false, text);
  }

  function mount() {
    if (document.getElementById("adr-composer-translator")) return;
    const host = document.createElement("div");
    host.id = "adr-composer-translator";
    host.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483647;display:none";
    const root = host.attachShadow({ mode: "closed" });
    // Sem innerHTML: Calendar, Drive, YouTube e outros sites exigem Trusted
    // Types, a atribuição lançava e o tradutor nunca aparecia. <style> por
    // textContent não é afetado.
    const style = document.createElement("style");
    style.textContent = `
      .box{display:flex;align-items:center;gap:6px;padding:6px;background:#111c24;border:1px solid #2b3a45;border-radius:10px;box-shadow:0 8px 24px #0005;font:12px Arial,sans-serif;color:#fff}
      select,button{height:30px;border:0;border-radius:7px;font:600 12px Arial,sans-serif}
      select{background:#18252f;color:#fff;padding:0 7px} button{background:#4da3ff;color:#07111b;padding:0 11px;cursor:pointer} button:disabled{opacity:.65;cursor:wait}
      output{max-width:180px;color:#cbd5e1}
      button.icon{background:transparent;color:#cbd5e1;padding:0 7px;font-size:16px;line-height:1} button.icon:hover,button.icon:focus-visible{background:#18252f;color:#fff}
      button.mini{width:34px;height:34px;padding:0;border-radius:50%;background:#111c24;color:#fff;border:1px solid #2b3a45;box-shadow:0 8px 24px #0005}
      .pill{display:flex;align-items:center;gap:2px} .pill button.icon{height:24px;padding:0 5px;font-size:14px;background:#111c24;border:1px solid #2b3a45}
      [hidden]{display:none!important}
    `;
    const box = document.createElement("div");
    box.className = "box";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "Tradutor ADR");
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Traduzir para");
    for (const [value, label] of [["en", "Inglês"], ["es", "Espanhol"], ["pt-BR", "Português"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Traduzir";
    const status = document.createElement("output");
    status.setAttribute("aria-live", "polite");
    const iconButton = (text, label, className = "icon") => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = className;
      element.textContent = text;
      element.title = label;
      element.setAttribute("aria-label", label);
      return element;
    };
    const minimize = iconButton("–", "Minimizar o tradutor");
    const close = iconButton("×", "Fechar o tradutor neste campo");
    const mini = iconButton("文A", "Mostrar o tradutor", "mini");
    const closeMini = iconButton("×", "Fechar o tradutor neste campo");
    // Minimizado: o ícone que reabre e o "×", para fechar sem reabrir antes.
    const pill = document.createElement("div");
    pill.className = "pill";
    pill.hidden = true;
    pill.append(mini, closeMini);
    const setCollapsed = (value) => {
      box.hidden = value;
      pill.hidden = !value;
      (value ? mini : select).focus();
    };
    const dismiss = () => {
      dismissedEditor = editor;
      host.style.display = "none";
    };
    minimize.addEventListener("click", () => setCollapsed(true));
    mini.addEventListener("click", () => setCollapsed(false));
    close.addEventListener("click", dismiss);
    closeMini.addEventListener("click", dismiss);
    box.append(select, button, status, minimize, close);
    root.append(style, box, pill);
    root.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", async (event) => {
      if (!event.isTrusted || busy || !editor || !editor.isConnected) return;
      const current = editor;
      const original = readText(current);
      if (!original.trim()) return;
      // A tradução troca o editor inteiro por texto puro: com link, imagem ou
      // menção, só substitui no segundo clique sobre o mesmo texto.
      const rich = !("value" in current) && current.querySelector(RICH);
      if (rich && (confirmedRich?.editor !== current || confirmedRich.text !== original)) {
        confirmedRich = { editor: current, text: original };
        status.textContent = "Links e formatação serão perdidos. Clique de novo para confirmar.";
        return;
      }
      confirmedRich = null;
      busy = true;
      button.disabled = true;
      status.textContent = "Traduzindo...";
      try {
        const result = await ipcRenderer.invoke("composer:translate", {
          text: original,
          target: select.value,
        });
        if (!result?.ok) throw new Error(result?.message || "Falha na tradução.");
        if (current.isConnected && readText(current) === original && result.data?.translatedText) {
          status.textContent = writeText(current, result.data.translatedText)
            ? "Pronto"
            : "Não foi possível substituir o texto";
        } else if (readText(current) !== original) {
          status.textContent = "Rascunho alterado";
        }
      } catch (error) {
        status.textContent = error?.message || "Falha na tradução";
      } finally {
        busy = false;
        button.disabled = false;
      }
    });
    document.documentElement.appendChild(host);

    document.addEventListener(
      "focusin",
      (event) => {
        // Só foco real: um focusin sintético deixaria o site escolher o que
        // traduzir. composedPath()[0] é o editor dentro de shadow root aberta;
        // event.target seria o host.
        if (!event.isTrusted) return;
        const next = editableFrom(event.composedPath()[0]);
        if (!next) return;
        // Campo em que a pessoa fechou: a barra some (inclusive se outro campo a
        // tinha mostrado) e não aponta mais para o editor anterior.
        if (next === dismissedEditor) {
          host.style.display = "none";
          return;
        }
        editor = next;
        host.style.display = "block";
        status.textContent = "";
      },
      true,
    );
  }

  // Erro na montagem era silencioso: o tradutor só não aparecia. O marcador
  // no console deixa o motivo no log da view.
  function mountSafely() {
    try {
      mount();
    } catch (error) {
      console.error("ADR_COMPOSER_TRANSLATOR:error:" + String(error?.name || "unknown"));
    }
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mountSafely, { once: true });
  else mountSafely();
}
