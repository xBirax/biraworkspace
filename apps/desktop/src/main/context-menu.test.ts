import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ Menu: {}, clipboard: {} }));

import { buildContextMenuSpec } from "./context-menu.js";

const noFlags = {
  canUndo: false,
  canRedo: false,
  canCut: false,
  canCopy: false,
  canPaste: false,
  canDelete: false,
  canSelectAll: false,
  canEditRichly: false,
};

function params(over: Partial<Parameters<typeof buildContextMenuSpec>[0]>) {
  return {
    mediaType: "none",
    isEditable: false,
    selectionText: "",
    linkURL: "",
    srcURL: "",
    editFlags: noFlags,
    ...over,
  } as Parameters<typeof buildContextMenuSpec>[0];
}

const actions = (spec: ReturnType<typeof buildContextMenuSpec>) =>
  spec.map((i) => ("role" in i ? i.role : "action" in i ? i.action : "|"));

describe("buildContextMenuSpec", () => {
  it("offers copy image on an image — o caminho de copiar de uma conversa", () => {
    const spec = buildContextMenuSpec(
      params({ mediaType: "image", srcURL: "blob:https://web.whatsapp.com/x" }),
    );
    expect(actions(spec)).toContain("copyImage");
  });

  it("offers paste in an editable field — o caminho de colar na outra conversa", () => {
    const spec = buildContextMenuSpec(
      params({ isEditable: true, editFlags: { ...noFlags, canPaste: true } }),
    );
    expect(actions(spec)).toContain("paste");
  });

  it("hides paste when Blink says the field cannot take it", () => {
    const spec = buildContextMenuSpec(params({ isEditable: true }));
    expect(actions(spec)).not.toContain("paste");
  });

  it("copies plain selection outside an editable field", () => {
    expect(actions(buildContextMenuSpec(params({ selectionText: "oi" })))).toEqual(["copy"]);
  });

  it("never returns an empty menu", () => {
    expect(buildContextMenuSpec(params({})).length).toBeGreaterThan(0);
  });

  it("separates groups when image and link overlap", () => {
    const spec = buildContextMenuSpec(
      params({ mediaType: "image", srcURL: "https://x/i.png", linkURL: "https://x/" }),
    );
    expect(actions(spec)).toContain("|");
    expect(actions(spec)).toContain("copyLink");
  });

  it("oferece as sugestões do corretor antes de editar, no máximo cinco", () => {
    const spec = buildContextMenuSpec(
      params({
        isEditable: true,
        editFlags: { ...noFlags, canPaste: true },
        misspelledWord: "naum",
        dictionarySuggestions: ["não", "nau", "num", "mau", "nam", "naus"],
      }),
    );
    const words = spec.flatMap((i) => (i.kind === "spelling" ? [i.word] : []));
    expect(words).toEqual(["não", "nau", "num", "mau", "nam"]);
    expect(spec[0]).toMatchObject({ kind: "spelling", word: "não" });
    expect(actions(spec)).toContain("addToDictionary");
    expect(actions(spec)).toContain("paste");
  });

  it("avisa quando o corretor não tem sugestão", () => {
    const spec = buildContextMenuSpec(
      params({ isEditable: true, misspelledWord: "xptoz", dictionarySuggestions: [] }),
    );
    expect(spec[0]).toMatchObject({ kind: "info", label: "Nenhuma sugestão" });
    expect(actions(spec)).toContain("addToDictionary");
  });

  it("não mostra corretor fora de campo editável", () => {
    const spec = buildContextMenuSpec(params({ misspelledWord: "naum", selectionText: "naum" }));
    expect(actions(spec)).toEqual(["copy"]);
  });
});

describe("buildContextMenuSpec no Bira Browser", () => {
  const nav = { canGoBack: true, canGoForward: false };

  it("oferece abrir link em nova aba antes de copiar", () => {
    const spec = buildContextMenuSpec(params({ linkURL: "https://x.com/" }), nav);
    expect(actions(spec).slice(0, 3)).toEqual(["openLinkNewTab", "copyLink", "openLinkExternal"]);
  });

  it("nos outros serviços não aparece nova aba nem pesquisa", () => {
    const spec = buildContextMenuSpec(params({ linkURL: "https://x.com/", selectionText: "oi" }));
    expect(actions(spec)).not.toContain("openLinkNewTab");
    expect(actions(spec)).not.toContain("searchSelection");
  });

  it("pesquisa a seleção com o texto encurtado no rótulo", () => {
    const spec = buildContextMenuSpec(
      params({ selectionText: "  nota   fiscal eletrônica de serviço " }),
      nav,
    );
    expect(actions(spec)).toEqual(["copy", "|", "searchSelection"]);
    expect(spec.at(-1)).toMatchObject({
      label: "Pesquisar no Google por “nota fiscal eletrônica de serv…”",
    });
  });

  it("página vazia ganha voltar/avançar/recarregar e imprimir", () => {
    const spec = buildContextMenuSpec(params({}), nav);
    expect(actions(spec)).toEqual(["back", "forward", "reload", "|", "print", "copyPageUrl"]);
    expect(spec[0]).toMatchObject({ enabled: true });
    expect(spec[1]).toMatchObject({ enabled: false });
  });
});

describe("rótulo da pesquisa", () => {
  it("encurta sem partir emoji", () => {
    const spec = buildContextMenuSpec(params({ selectionText: `${"x".repeat(29)}😀😀😀` }), {
      canGoBack: false,
      canGoForward: false,
    });
    const label = spec.find((i) => "action" in i && i.action === "searchSelection");
    expect(label).toMatchObject({ label: `Pesquisar no Google por “${"x".repeat(29)}😀…”` });
  });
});
