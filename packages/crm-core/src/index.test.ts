import { describe, expect, it } from "vitest";
import {
  disambiguateContacts,
  mapHttpStatusToCrmErrorCode,
  normalizeAllowedBaseUrl,
  normalizeTranscriptCache,
  upsertTranscriptCache,
  chatKey,
  titleParts,
  isSameComposerText,
} from "../src/index.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("crm-core base URL policy", () => {
  it("keeps production origin", () => {
    expect(normalizeAllowedBaseUrl("https://app.adragencia.com.br/")).toBe(
      "https://app.adragencia.com.br",
    );
  });

  it("rejects arbitrary origins", () => {
    expect(normalizeAllowedBaseUrl("https://evil.example")).toBe(
      "https://app.adragencia.com.br",
    );
  });

  it("allows localhost only when unpackaged", () => {
    expect(normalizeAllowedBaseUrl("http://localhost:3000", { allowLocalhost: false })).toBe(
      "https://app.adragencia.com.br",
    );
    expect(normalizeAllowedBaseUrl("http://localhost:3000", { allowLocalhost: true })).toBe(
      "http://localhost:3000",
    );
  });
});

describe("crm-core error mapping", () => {
  it("maps auth and rate-limit statuses", () => {
    expect(mapHttpStatusToCrmErrorCode(401)).toBe("UNAUTHENTICATED");
    expect(mapHttpStatusToCrmErrorCode(403)).toBe("FORBIDDEN");
    expect(mapHttpStatusToCrmErrorCode(429)).toBe("RATE_LIMITED");
  });
});

describe("transcript cache parity with shared.js", () => {
  it("upserts and normalizes entries", () => {
    const now = 1_700_000_000_000;
    const next = upsertTranscriptCache({}, "msg-1", " olá ", now);
    expect(next["msg-1"]?.text).toBe("olá");
    expect(normalizeTranscriptCache(next, now)["msg-1"]?.text).toBe("olá");
  });
});

describe("lookup disambiguation parity", () => {
  it("prefers contact matching person + company token", () => {
    const found = [
      { id: "1", name: "Ana Paula", company: null },
      { id: "2", name: "Ana Paula Quo", company: { name: "Jiaogepengyou CN" } },
    ];
    const picked = disambiguateContacts(found, "Ana Paula Quo | Jiaogepengyou");
    expect(picked.map((c) => c.id)).toEqual(["2"]);
  });
});

describe("chatKey", () => {
  it("prefers jid then phone then title", () => {
    expect(chatKey({ id: "x@c.us" }, "Titulo")).toBe("jid:x@c.us");
    expect(chatKey({ phone: "55 11 99999-9999" }, "Titulo")).toBe("phone:5511999999999");
    expect(chatKey({}, "  Olá ")).toMatch(/^title:/);
  });
});

describe("titleParts parity with shared.js", () => {
  it("splits person and company on | - – — • ·", () => {
    expect(titleParts("Ana Paula | Acme")).toEqual({ person: "Ana Paula", company: "Acme" });
    expect(titleParts("Joao - Label")).toEqual({ person: "Joao", company: "Label" });
    expect(titleParts("A–B—C•D·E")).toEqual({ person: "A", company: "B" });
    expect(titleParts("  Só Nome  ")).toEqual({ person: "Só Nome", company: "" });
  });

  it("keeps hyphenated names whole; hyphen only splits with spaces around it", () => {
    expect(titleParts("Ana-Maria Souza")).toEqual({ person: "Ana-Maria Souza", company: "" });
    expect(titleParts("Jean-Pierre | Acme")).toEqual({ person: "Jean-Pierre", company: "Acme" });
    expect(titleParts("Ana-Maria - Coca-Cola")).toEqual({ person: "Ana-Maria", company: "Coca-Cola" });
  });

  it("drops phone-number-only parts and empty input", () => {
    expect(titleParts("+55 11 98237-6057")).toEqual({ person: "", company: "" });
    expect(titleParts("+55 (11) 98237.6057")).toEqual({ person: "", company: "" });
    expect(titleParts("Ana | 123")).toEqual({ person: "Ana", company: "" });
    expect(titleParts(" | Acme")).toEqual({ person: "Acme", company: "" });
    expect(titleParts(null)).toEqual({ person: "", company: "" });
    expect(titleParts(undefined)).toEqual({ person: "", company: "" });
  });

  it("matches the vendored shared.js implementation", () => {
    // A pasta mais nova, como em build.test.ts: uma versão fixa aqui seguiria
    // passando contra a extensão antiga depois do próximo release.
    const vendorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../vendor");
    const newest = fs
      .readdirSync(vendorRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^adr-crm-extension-\d/.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }))
      .at(-1)!;
    const vendored = fs.readFileSync(path.join(vendorRoot, newest, "shared.js"), "utf8");
    const root: { CRMWAUtils?: { titleParts: typeof titleParts } } = {};
    new Function("globalThis", vendored)(root);
    for (const t of [
      "Ana | Acme",
      "+55 11 98237-6057",
      "x - 1 - y",
      "",
      "Bob•Co",
      "a|b|c",
      "(11) 9999",
      "Ana-Maria Souza",
      "Ana-Maria - Coca-Cola",
    ]) {
      expect(titleParts(t)).toEqual(root.CRMWAUtils!.titleParts(t));
    }
  });
});

describe("crm-core purity", () => {
  it("does not import chrome, electron, or DOM APIs", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const srcDir = path.join(dir, "..");
    const files = fs
      .readdirSync(srcDir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const file of files) {
      const text = fs.readFileSync(path.join(srcDir, file), "utf8");
      expect(text).not.toMatch(/\bchrome\b/);
      expect(text).not.toMatch(/\belectron\b/);
      expect(text).not.toMatch(/\bdocument\b/);
      expect(text).not.toMatch(/\bwindow\b/);
    }
  });
});

describe("isSameComposerText", () => {
  it("ignora a contagem de linhas em branco que o Lexical muda ao colar", () => {
    const sent = "https://x.com/a/\n\nhttps://x.com/b/ especially this one";
    expect(isSameComposerText("https://x.com/a/\n\n\n\nhttps://x.com/b/ especially this one", sent)).toBe(true);
    expect(isSameComposerText("https://x.com/a/\nhttps://x.com/b/ especially this one\n", sent)).toBe(true);
  });

  it("continua recusando conteúdo diferente ou anexado", () => {
    expect(isSameComposerText("oi\ntchau", "oi\ntchau!")).toBe(false);
    // Tradução colada junto do original em vez de substituí-lo.
    expect(isSameComposerText("olá\n\nhello", "hello")).toBe(false);
    // Quebra de linha no meio da frase não é linha em branco.
    expect(isSameComposerText("a b", "a\nb")).toBe(false);
  });
});
