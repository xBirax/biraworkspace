import { describe, expect, it } from "vitest";
import {
  ClosedTabStack,
  completeWithWww,
  findSeedFromSelection,
  googleSearchUrl,
  nextZoomLevel,
  pageOwnsFindAndPrint,
  pickFavicon,
  pickSpellCheckerLanguages,
  truncateChars,
} from "./browser-features.js";

describe("nextZoomLevel", () => {
  it("sobe e desce pelos degraus do Chrome", () => {
    expect(nextZoomLevel(1, 1)).toBe(1.1);
    expect(nextZoomLevel(1.1, 1)).toBe(1.25);
    expect(nextZoomLevel(1, -1)).toBe(0.9);
    expect(nextZoomLevel(0.67, -1)).toBe(0.5);
  });

  it("de valor fora da lista vai ao degrau seguinte, e para nas pontas", () => {
    expect(nextZoomLevel(1.05, 1)).toBe(1.1);
    expect(nextZoomLevel(1.05, -1)).toBe(1);
    expect(nextZoomLevel(5, 1)).toBe(5);
    expect(nextZoomLevel(0.25, -1)).toBe(0.25);
  });
});

describe("completeWithWww", () => {
  it("completa palavra solta", () => {
    expect(completeWithWww("exemplo")).toBe("www.exemplo.com");
    expect(completeWithWww(" adr-agencia ")).toBe("www.adr-agencia.com");
  });

  it("não mexe em endereço nem em busca", () => {
    expect(completeWithWww("exemplo.com.br")).toBe("exemplo.com.br");
    expect(completeWithWww("como fazer bolo")).toBe("como fazer bolo");
    expect(completeWithWww("https://x")).toBe("https://x");
  });
});

describe("googleSearchUrl", () => {
  it("codifica o texto", () => {
    expect(googleSearchUrl("  café & pão ")).toBe(
      "https://www.google.com/search?q=caf%C3%A9%20%26%20p%C3%A3o",
    );
  });
});

describe("findSeedFromSelection", () => {
  it("junta em uma linha", () => {
    expect(findSeedFromSelection("  nota\n fiscal ")).toBe("nota fiscal");
  });

  it("ignora seleção vazia ou longa demais", () => {
    expect(findSeedFromSelection("   ")).toBe("");
    expect(findSeedFromSelection("a".repeat(121))).toBe("");
  });
});

describe("pageOwnsFindAndPrint", () => {
  it("deixa o Ctrl+F/Ctrl+P com o Docs e as Planilhas", () => {
    expect(pageOwnsFindAndPrint("https://docs.google.com/document/d/abc/edit")).toBe(true);
    expect(pageOwnsFindAndPrint("https://docs.google.com/spreadsheets/d/abc/edit")).toBe(true);
  });

  it("intercepta no resto, inclusive em URL inválida", () => {
    expect(pageOwnsFindAndPrint("https://www.google.com/search?q=docs.google.com")).toBe(false);
    expect(pageOwnsFindAndPrint("https://evil.example/docs.google.com")).toBe(false);
    expect(pageOwnsFindAndPrint("")).toBe(false);
  });
});

describe("pickFavicon", () => {
  it("fica com o primeiro ícone http(s)", () => {
    expect(
      pickFavicon([
        "data:image/png;base64,AAAA",
        "https://site.com/favicon.ico",
        "https://site.com/b.png",
      ]),
    ).toBe("https://site.com/favicon.ico");
  });

  it("recusa esquemas que não são web e endereço gigante", () => {
    expect(pickFavicon(["javascript:alert(1)", "file:///c:/x.ico"])).toBeNull();
    expect(pickFavicon([`https://site.com/${"a".repeat(3000)}`])).toBeNull();
    expect(pickFavicon([])).toBeNull();
  });
});

describe("pickSpellCheckerLanguages", () => {
  it("põe o português por último, que é de onde o Windows tira as sugestões", () => {
    expect(pickSpellCheckerLanguages(["pt-BR", "fr", "en-US"])).toEqual(["en-US", "pt-BR"]);
  });

  it("aceita o código curto quando é o que existe", () => {
    expect(pickSpellCheckerLanguages(["pt", "en"])).toEqual(["en", "pt"]);
  });

  it("devolve vazio quando nenhum dos dois está disponível", () => {
    expect(pickSpellCheckerLanguages(["de-DE"])).toEqual([]);
  });
});

describe("ClosedTabStack", () => {
  const tab = (serviceId: string, workspaceId = "w1") => ({
    serviceId,
    workspaceId,
    index: 0,
    url: `https://${serviceId}.com/`,
  });

  it("devolve a última aba fechada primeiro", () => {
    const stack = new ClosedTabStack();
    stack.push(tab("a"));
    stack.push(tab("b"));
    expect(stack.popFor("w1", () => true)?.serviceId).toBe("b");
    expect(stack.popFor("w1", () => true)?.serviceId).toBe("a");
    expect(stack.popFor("w1", () => true)).toBeUndefined();
  });

  it("só reabre aba do workspace da janela", () => {
    const stack = new ClosedTabStack();
    stack.push(tab("a", "w1"));
    stack.push(tab("b", "w2"));
    expect(stack.popFor("w1", () => true)?.serviceId).toBe("a");
    expect(stack.size).toBe(1);
  });

  it("descarta no caminho as que não dá mais para restaurar", () => {
    const stack = new ClosedTabStack();
    stack.push(tab("a"));
    stack.push(tab("gone"));
    expect(stack.popFor("w1", (id) => id !== "gone")?.serviceId).toBe("a");
    expect(stack.size).toBe(0);
  });

  it("não guarda a mesma aba duas vezes e respeita o limite", () => {
    const stack = new ClosedTabStack(2);
    stack.push(tab("a"));
    stack.push(tab("a"));
    expect(stack.size).toBe(1);
    stack.push(tab("b"));
    stack.push(tab("c"));
    expect(stack.size).toBe(2);
    expect(stack.popFor("w1", () => true)?.serviceId).toBe("c");
    expect(stack.popFor("w1", () => true)?.serviceId).toBe("b");
  });
});

describe("truncateChars", () => {
  it("não parte um emoji no meio", () => {
    const text = `${"a".repeat(499)}😀fim`;
    const cut = truncateChars(text, 500);
    expect(cut.endsWith("😀")).toBe(true);
    expect(() => encodeURIComponent(cut)).not.toThrow();
  });

  it("não mexe no que já cabe", () => {
    expect(truncateChars("abc", 5)).toBe("abc");
  });
});

describe("googleSearchUrl com emoji no limite", () => {
  it("não lança URIError", () => {
    expect(() => googleSearchUrl(`${"b".repeat(499)}😀😀`)).not.toThrow();
  });
});
