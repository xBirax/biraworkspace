import { describe, expect, it } from "vitest";
import { newContactUrl, toE164 } from "./google-contacts.js";

describe("formulário de novo contato do Google", () => {
  it("preenche nome e telefone na conta escolhida", () => {
    // Grafias medidas no navegador: só `givenname` e `phone` funcionam.
    const url = new URL(newContactUrl("Ana Mosconi", "+5511999998888", "eu@gmail.com"));
    expect(url.origin + url.pathname).toBe("https://contacts.google.com/new");
    expect(url.searchParams.get("givenname")).toBe("Ana Mosconi");
    expect(url.searchParams.get("phone")).toBe("+5511999998888");
    expect(url.searchParams.get("authuser")).toBe("eu@gmail.com");
  });

  it("omite o que não existe em vez de mandar vazio", () => {
    // Contato fora da agenda não tem nome, e conta não configurada abre na
    // conta padrão do navegador.
    const url = new URL(newContactUrl(null, "+5511999998888"));
    expect(url.searchParams.has("givenname")).toBe(false);
    expect(url.searchParams.has("authuser")).toBe(false);
    expect(url.searchParams.get("phone")).toBe("+5511999998888");
  });

  it("converte o telefone do WhatsApp para E.164", () => {
    expect(toE164("5511999998888")).toBe("+5511999998888");
    expect(toE164("")).toBe("");
  });
});
