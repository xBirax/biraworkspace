import { describe, expect, it } from "vitest";
import { redactSecrets, safeLogLine } from "./redact.js";

describe("redactSecrets", () => {
  it("redacts bearer and cookies", () => {
    expect(redactSecrets("Authorization: Bearer abc.def.ghi")).toContain("[REDACTED]");
    expect(redactSecrets("auth_token=supersecret; Path=/")).toContain("auth_token=[REDACTED]");
  });

  it("redacts jwt-looking tokens", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart11";
    expect(redactSecrets(`token ${jwt}`)).toContain("[JWT_REDACTED]");
  });

  it("redacts third-party session cookies", () => {
    expect(redactSecrets("sp_dc=AQBxyz123; sp_key=abc")).not.toContain("AQBxyz123");
    expect(redactSecrets("sp_dc=AQBxyz123")).toContain("sp_dc=[REDACTED]");
  });
});

describe("query strings e tokens Google", () => {
  it("tira a query das URLs e o token ya29", () => {
    const line = safeLogLine("info", "xhr 4xx", {
      url: "https://app.adragencia.com.br/negocios?vincularTelefone=5511999&vincularNome=Ana",
      other: "https://x.example/cb?code=abc123&state=s#frag",
      header: "Authorization: ya29.a0AfH6SMBxyz-_",
    });
    expect(line).toContain("https://app.adragencia.com.br/negocios?[query]");
    expect(line).not.toContain("5511999");
    expect(line).not.toContain("abc123");
    expect(line).not.toContain("ya29.a0");
  });
});

describe("safeLogLine", () => {
  it("never leaves password fields", () => {
    expect(safeLogLine("info", "login", { password: "hunter2" })).not.toContain("hunter2");
  });

  it("survives a circular payload instead of throwing", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular["self"] = circular;
    expect(() => safeLogLine("error", "boom", circular)).not.toThrow();
    expect(safeLogLine("error", "boom", circular)).toContain("não serializável");
  });
});

describe("fragmentos e esquemas com dado de pessoa", () => {
  it("corta o fragmento de URL (token OAuth implícito, busca do Gmail)", () => {
    const out = redactSecrets(
      "https://example.com/cb#access_token=abc&state=1 https://mail.google.com/mail/u/0/#search/cliente@x.com",
    );
    expect(out).toContain("https://example.com/cb#[fragment]");
    expect(out).not.toContain("access_token=abc");
    expect(out).not.toContain("cliente@x.com");
  });

  it("corta query e fragmento juntos", () => {
    expect(redactSecrets("https://a.com/p?code=1#x=2")).toBe("https://a.com/p?[query]#[fragment]");
  });

  it("não guarda endereço, assunto nem número de mailto/tel", () => {
    const out = redactSecrets("abrir mailto:fulano@x.com?subject=Oi e tel:+5511999990000");
    expect(out).toBe("abrir mailto:[REDACTED] e tel:[REDACTED]");
  });
});
