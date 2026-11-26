import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BrowserHistoryStore,
  HISTORY_MAX_ENTRIES,
  HISTORY_RETENTION_MS,
  isRecordableUrl,
  pruneHistory,
  recordVisit,
  searchHistory,
  updateHistoryTitle,
  type HistoryEntry,
} from "./browser-history.js";

describe("isRecordableUrl", () => {
  it("aceita páginas comuns", () => {
    expect(isRecordableUrl("https://www.example.com/artigo?id=7")).toBe(true);
    expect(isRecordableUrl("https://www.google.com/search?q=adr")).toBe(true);
    expect(isRecordableUrl("https://mail.google.com/mail/u/0/?authuser=1#inbox")).toBe(true);
  });

  it("recusa páginas de login", () => {
    expect(isRecordableUrl("https://accounts.google.com/v3/signin/identifier")).toBe(false);
    expect(isRecordableUrl("https://login.microsoftonline.com/common/oauth2")).toBe(false);
    expect(isRecordableUrl("https://auth.openai.com/u/login")).toBe(false);
    expect(isRecordableUrl("https://sso.empresa.com.br/")).toBe(false);
    expect(isRecordableUrl("https://www.linkedin.com/login")).toBe(false);
    expect(isRecordableUrl("https://github.com/login/oauth/authorize?client_id=x")).toBe(false);
  });

  it("recusa endereço com código ou token, inclusive no fragmento", () => {
    expect(isRecordableUrl("https://app.example.com/callback?code=abc&state=xyz")).toBe(false);
    expect(isRecordableUrl("https://app.example.com/?TOKEN=abc")).toBe(false);
    expect(isRecordableUrl("https://app.example.com/#access_token=abc&expires_in=3600")).toBe(
      false,
    );
    expect(isRecordableUrl("https://usuario:senha@example.com/")).toBe(false);
  });

  it("recusa o que não é web", () => {
    expect(isRecordableUrl("data:text/html,oi")).toBe(false);
    expect(isRecordableUrl("about:blank")).toBe(false);
    expect(isRecordableUrl("file:///c:/x")).toBe(false);
    expect(isRecordableUrl(`https://example.com/${"a".repeat(3000)}`)).toBe(false);
  });
});

describe("recordVisit / pruneHistory", () => {
  const now = Date.UTC(2026, 9, 16);

  it("uma entrada por endereço, a visita nova no topo, contando visitas", () => {
    let entries: HistoryEntry[] = [];
    entries = recordVisit(entries, { url: "https://a.com/", title: "A" }, now - 2000);
    entries = recordVisit(entries, { url: "https://b.com/", title: "B" }, now - 1000);
    entries = recordVisit(entries, { url: "https://a.com/", title: "" }, now);
    expect(entries.map((e) => e.url)).toEqual(["https://a.com/", "https://b.com/"]);
    expect(entries[0]).toMatchObject({ title: "A", visitCount: 2, lastVisitedAt: now });
  });

  it("não grava endereço proibido", () => {
    const entries = recordVisit([], { url: "https://accounts.google.com/x", title: "Login" }, now);
    expect(entries).toEqual([]);
  });

  it("apaga o que passou de 90 dias e respeita o teto", () => {
    const old = {
      url: "https://old.com/",
      title: "",
      lastVisitedAt: now - HISTORY_RETENTION_MS - 1,
      visitCount: 1,
    };
    const fresh = { url: "https://new.com/", title: "", lastVisitedAt: now, visitCount: 1 };
    expect(pruneHistory([old, fresh], now)).toEqual([fresh]);
    const many = Array.from({ length: HISTORY_MAX_ENTRIES + 5 }, (_, i) => ({
      url: `https://s${i}.com/`,
      title: "",
      lastVisitedAt: now - i,
      visitCount: 1,
    }));
    const pruned = pruneHistory(many, now);
    expect(pruned).toHaveLength(HISTORY_MAX_ENTRIES);
    expect(pruned[0]?.url).toBe("https://s0.com/");
  });

  it("título chega depois sem contar visita", () => {
    const entries = recordVisit([], { url: "https://a.com/", title: "" }, now);
    const titled = updateHistoryTitle(entries, "https://a.com/", "  Página   A ");
    expect(titled[0]).toMatchObject({ title: "Página A", visitCount: 1 });
  });
});

describe("searchHistory", () => {
  const entries: HistoryEntry[] = [
    { url: "https://loja.com/cafe", title: "Café Especial", lastVisitedAt: 3, visitCount: 1 },
    { url: "https://news.com/eleicao", title: "Eleição 2026", lastVisitedAt: 2, visitCount: 1 },
    { url: "https://cafe.com/", title: "Outro", lastVisitedAt: 1, visitCount: 1 },
  ];

  it("ignora acento e maiúscula e busca no título e no endereço", () => {
    expect(searchHistory(entries, "cafe").map((e) => e.url)).toEqual([
      "https://loja.com/cafe",
      "https://cafe.com/",
    ]);
    expect(searchHistory(entries, "ELEICAO")).toHaveLength(1);
  });

  it("todas as palavras precisam aparecer; vazio devolve tudo", () => {
    expect(searchHistory(entries, "café loja")).toHaveLength(1);
    expect(searchHistory(entries, "")).toHaveLength(3);
  });
});

describe("BrowserHistoryStore", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const tempFile = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-history-"));
    dirs.push(dir);
    return path.join(dir, "history", "browser-history.v1.json");
  };
  // "Criptografia" de teste: reversível e visível, para conferir que o arquivo
  // não guarda o texto puro.
  const storage = (available = true) => ({
    isEncryptionAvailable: () => available,
    encryptString: (text: string) => Buffer.from(`enc:${Buffer.from(text).toString("hex")}`),
    decryptString: (buffer: Buffer) =>
      Buffer.from(buffer.toString().replace(/^enc:/, ""), "hex").toString(),
  });

  it("grava criptografado e lê de volta histórico e abas", () => {
    const file = tempFile();
    const store = new BrowserHistoryStore(file, storage(), () => 1000);
    store.visit("https://example.com/pagina", "Exemplo");
    store.setTab("tab-1", { url: "https://example.com/pagina", title: "Exemplo" });
    store.flush();
    expect(fs.readFileSync(file, "utf8")).not.toContain("example.com");

    const reopened = new BrowserHistoryStore(file, storage(), () => 2000);
    expect(reopened.search("exemplo").map((e) => e.url)).toEqual(["https://example.com/pagina"]);
    expect(reopened.restoreTabs((id) => id === "tab-1")).toEqual({
      "tab-1": { url: "https://example.com/pagina", title: "Exemplo" },
    });
  });

  it("sem criptografia do sistema não grava nada no disco", () => {
    const file = tempFile();
    const store = new BrowserHistoryStore(file, storage(false), () => 1000);
    store.visit("https://example.com/", "Exemplo");
    store.flush();
    expect(fs.existsSync(file)).toBe(false);
    expect(store.search("")).toHaveLength(1);
  });

  it("limpar apaga o histórico mas mantém as abas abertas", () => {
    const file = tempFile();
    const store = new BrowserHistoryStore(file, storage(), () => 1000);
    store.visit("https://example.com/", "Exemplo");
    store.setTab("tab-1", { url: "https://example.com/", title: "Exemplo" });
    store.clear();
    const reopened = new BrowserHistoryStore(file, storage(), () => 2000);
    expect(reopened.search("")).toEqual([]);
    expect(Object.keys(reopened.restoreTabs(() => true))).toEqual(["tab-1"]);
  });

  it("aba que não existe mais sai; aba que passou por login fica na página anterior", () => {
    const file = tempFile();
    const store = new BrowserHistoryStore(file, storage(), () => 1000);
    store.setTab("tab-1", { url: "https://example.com/", title: "" });
    store.setTab("tab-2", { url: "https://example.com/b", title: "B" });
    store.setTab("tab-2", { url: "https://accounts.google.com/x", title: "Login" });
    expect(store.restoreTabs((id) => id !== "tab-1")).toEqual({
      "tab-2": { url: "https://example.com/b", title: "B" },
    });
    store.setTab("tab-2", null);
    expect(store.restoreTabs(() => true)).toEqual({});
  });

  it("arquivo ilegível começa vazio, sem lançar", () => {
    const file = tempFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "lixo");
    const store = new BrowserHistoryStore(file, storage(), () => 1000);
    expect(store.search("")).toEqual([]);
    store.visit("https://example.com/", "Nova visita");
    store.flush();
    const preserved = fs.readdirSync(path.dirname(file)).find(name => name.includes(".unreadable-"));
    expect(preserved).toBeTruthy();
    expect(fs.readFileSync(path.join(path.dirname(file), preserved!), "utf8")).toBe("lixo");
  });
});
