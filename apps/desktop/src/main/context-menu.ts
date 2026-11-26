import { Menu, clipboard, type ContextMenuParams, type WebContents } from "electron";
import { googleSearchUrl, truncateChars } from "./browser-features.js";

/**
 * O Electron não tem menu de contexto: sem este handler, botão direito dentro de
 * qualquer view não faz nada. Era esse o buraco do "não consigo copiar uma
 * imagem de uma conversa e colar em outra" — sem "Copiar imagem" não há como
 * pôr a figura no clipboard, e Ctrl+V do outro lado cola o nada.
 */
export type MenuItemSpec =
  | { kind: "separator" }
  | { kind: "role"; role: "cut" | "copy" | "paste" | "pasteAndMatchStyle" | "selectAll"; label: string }
  | {
      kind: "action";
      action:
        | "copyImage"
        | "copyImageUrl"
        | "saveImage"
        | "copyLink"
        | "openLinkExternal"
        | "reload"
        | "addToDictionary"
        | "openLinkNewTab"
        | "searchSelection"
        | "back"
        | "forward"
        | "print"
        | "copyPageUrl";
      label: string;
      enabled?: boolean;
    }
  | { kind: "spelling"; word: string; label: string }
  | { kind: "info"; label: string };

type Params = Pick<
  ContextMenuParams,
  "mediaType" | "isEditable" | "selectionText" | "linkURL" | "srcURL" | "editFlags"
> &
  Partial<Pick<ContextMenuParams, "misspelledWord" | "dictionarySuggestions">>;

/**
 * Página do Bira Browser: o menu ganha o que se espera de um navegador (abrir
 * link em nova aba, pesquisar a seleção, voltar/avançar, imprimir). Nos outros
 * serviços fica de fora — "nova aba" lá seria uma aba do Browser surgindo do nada.
 */
export type BrowserMenuContext = { canGoBack: boolean; canGoForward: boolean };

const SEP: MenuItemSpec = { kind: "separator" };

/** "Pesquisar no Google por “…”" com a seleção encurtada, como no Chrome. */
function searchLabel(selection: string): string {
  const text = selection.replace(/\s+/g, " ").trim();
  const short = truncateChars(text, 30);
  return `Pesquisar no Google por “${short === text ? text : `${short}…`}”`;
}

/** Puro para dar para testar sem abrir uma janela. */
export function buildContextMenuSpec(params: Params, browser?: BrowserMenuContext): MenuItemSpec[] {
  const groups: MenuItemSpec[][] = [];
  const flags = params.editFlags;

  // Palavra sublinhada pelo corretor: sem isto o sublinhado aparecia e não
  // havia como trocar a palavra nem ensinar uma nova.
  if (params.isEditable && params.misspelledWord) {
    const suggestions = (params.dictionarySuggestions ?? []).slice(0, 5);
    groups.push([
      ...(suggestions.length
        ? suggestions.map((word): MenuItemSpec => ({ kind: "spelling", word, label: word }))
        : [{ kind: "info", label: "Nenhuma sugestão" } as const]),
      { kind: "action", action: "addToDictionary", label: "Adicionar ao dicionário" },
    ]);
  }

  if (params.mediaType === "image" && params.srcURL) {
    groups.push([
      { kind: "action", action: "copyImage", label: "Copiar imagem" },
      { kind: "action", action: "copyImageUrl", label: "Copiar endereço da imagem" },
      { kind: "action", action: "saveImage", label: "Salvar imagem como…" },
    ]);
  }

  if (params.linkURL) {
    groups.push([
      ...(browser
        ? [{ kind: "action", action: "openLinkNewTab", label: "Abrir link em nova aba" } as const]
        : []),
      { kind: "action", action: "copyLink", label: "Copiar link" },
      { kind: "action", action: "openLinkExternal", label: "Abrir no navegador" },
    ]);
  }

  if (params.isEditable) {
    const edit: MenuItemSpec[] = [];
    if (flags.canCut) edit.push({ kind: "role", role: "cut", label: "Recortar" });
    if (flags.canCopy) edit.push({ kind: "role", role: "copy", label: "Copiar" });
    // Colar é o outro lado do "copiar imagem": o role manda um paste de verdade
    // para o Blink, então a imagem do clipboard entra no composer do WhatsApp.
    if (flags.canPaste) {
      edit.push({ kind: "role", role: "paste", label: "Colar" });
      edit.push({ kind: "role", role: "pasteAndMatchStyle", label: "Colar sem formatação" });
    }
    if (flags.canSelectAll) edit.push({ kind: "role", role: "selectAll", label: "Selecionar tudo" });
    if (edit.length) groups.push(edit);
  } else if (params.selectionText.trim()) {
    groups.push([{ kind: "role", role: "copy", label: "Copiar" }]);
  }

  if (browser && params.selectionText.trim()) {
    groups.push([
      { kind: "action", action: "searchSelection", label: searchLabel(params.selectionText) },
    ]);
  }

  if (!groups.length && browser) {
    groups.push(
      [
        { kind: "action", action: "back", label: "Voltar", enabled: browser.canGoBack },
        { kind: "action", action: "forward", label: "Avançar", enabled: browser.canGoForward },
        { kind: "action", action: "reload", label: "Recarregar" },
      ],
      [
        { kind: "action", action: "print", label: "Imprimir…" },
        { kind: "action", action: "copyPageUrl", label: "Copiar endereço da página" },
      ],
    );
  }
  if (!groups.length) groups.push([{ kind: "action", action: "reload", label: "Recarregar" }]);

  return groups.flatMap((group, index) => (index ? [SEP, ...group] : group));
}

export type BrowserMenuActions = {
  openInNewTab: (url: string) => void;
  print: () => void;
};

export function attachContextMenu(
  contents: WebContents,
  openExternal: (url: string) => void,
  browser?: BrowserMenuActions,
): void {
  contents.on("context-menu", (_event, params) => {
    const history = contents.navigationHistory;
    const context = browser
      ? { canGoBack: history.canGoBack(), canGoForward: history.canGoForward() }
      : undefined;
    const template = buildContextMenuSpec(params, context).map((item) => {
      if (item.kind === "separator") return { type: "separator" as const };
      if (item.kind === "role") return { role: item.role, label: item.label };
      if (item.kind === "info") return { label: item.label, enabled: false };
      if (item.kind === "spelling") {
        return { label: item.label, click: () => contents.replaceMisspelling(item.word) };
      }
      return {
        label: item.label,
        enabled: item.enabled ?? true,
        click: () => {
          switch (item.action) {
            case "openLinkNewTab":
              browser?.openInNewTab(params.linkURL);
              return;
            case "searchSelection":
              browser?.openInNewTab(googleSearchUrl(params.selectionText));
              return;
            case "back":
              if (history.canGoBack()) history.goBack();
              return;
            case "forward":
              if (history.canGoForward()) history.goForward();
              return;
            case "print":
              browser?.print();
              return;
            case "copyPageUrl":
              clipboard.writeText(contents.getURL());
              return;
            case "copyImage":
              // copyImageAt lê o bitmap decodificado da própria página — não
              // baixa de novo, então funciona com blob:/data: do WhatsApp.
              contents.copyImageAt(params.x, params.y);
              return;
            case "copyImageUrl":
              clipboard.writeText(params.srcURL);
              return;
            case "saveImage":
              contents.downloadURL(params.srcURL);
              return;
            case "copyLink":
              clipboard.writeText(params.linkURL);
              return;
            case "openLinkExternal":
              openExternal(params.linkURL);
              return;
            case "reload":
              contents.reload();
              return;
            case "addToDictionary":
              contents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
              return;
          }
        },
      };
    });
    Menu.buildFromTemplate(template).popup();
  });
}
