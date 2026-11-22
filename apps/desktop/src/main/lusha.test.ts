import { describe, expect, it } from "vitest";
import {
  buildLushaCardScript,
  normalizeLinkedInProfileUrl,
  parseLushaContact,
  summarizeLushaContact,
} from "./lusha.js";

describe("Lusha adapter", () => {
  it("normalizes only LinkedIn person profile URLs", () => {
    expect(normalizeLinkedInProfileUrl("https://www.linkedin.com/in/ana-silva/?trk=foo")).toBe(
      "https://www.linkedin.com/in/ana-silva",
    );
    expect(normalizeLinkedInProfileUrl("http://www.linkedin.com/in/ana")).toBeNull();
    expect(normalizeLinkedInProfileUrl("https://www.linkedin.com/company/adr")).toBeNull();
    expect(normalizeLinkedInProfileUrl("https://example.com/in/ana")).toBeNull();
  });

  it("resume o resultado sanitizado devolvido pelo CRM", () => {
    const result = {
      id: "c-1",
      fullName: "Ana Silva",
      jobTitle: "Diretora",
      has: ["emails"],
      emails: [{ email: "ana@example.com" }],
    };
    expect(summarizeLushaContact(result)).toContain("Nome: Ana Silva");
    expect(summarizeLushaContact(result)).toContain("E-mail: ana@example.com");
  });

  it("formata campos reveláveis estruturados sem exibir [object Object]", () => {
    const summary = summarizeLushaContact({
      id: "c-2",
      fullName: "Gabriel Baeta",
      canReveal: [
        { field: "emails", credits: 1 },
        { field: "phones", credits: 2 },
      ],
    });
    expect(summary).toContain("Revelável: emails (1 crédito), phones (2 créditos)");
    expect(summary).not.toContain("[object Object]");
  });

  it("parseLushaContact extrai dados estruturados para o card", () => {
    const parsed = parseLushaContact({
      id: "c-3",
      fullName: "Paulo Augusto Sebin",
      jobTitle: "Diretor de Tecnologia",
      companyName: "Advise",
      emails: [{ email: "paulo.sebin@advise.com.br" }],
      phones: [{ number: "+55 43 99960-8993" }],
    });
    expect(parsed?.fullName).toBe("Paulo Augusto Sebin");
    expect(parsed?.jobTitle).toBe("Diretor de Tecnologia");
    expect(parsed?.companyName).toBe("Advise");
    expect(parsed?.linkedinUrl).toBeNull();
    expect(parsed?.emails).toEqual(["paulo.sebin@advise.com.br"]);
    expect(parsed?.phones).toEqual(["+55 43 99960-8993"]);
    expect(parsed?.hasContactId).toBe(true);
  });

  it("buildLushaCardScript gera script válido para injeção com suporte a cópia", () => {
    const script = buildLushaCardScript("revealed", {
      fullName: "Paulo Augusto Sebin",
      jobTitle: "Diretor",
      companyName: "Advise",
      emails: ["paulo.sebin@advise.com.br"],
      phones: ["+55 43 99960-8993"],
    });
    expect(script).toContain("adr-lusha-host");
    expect(script).toContain("copyToClipboard");
    expect(script).toContain("paulo.sebin@advise.com.br");
    expect(script).toContain("+55 43 99960-8993");
    expect(script).toContain("Copiar tudo");
    expect(script).toContain("Preparar negócio");
    expect(script).toContain('resolve("prepareDeal")');
    // Sintaxe válida de verdade (só compila; não executa no Node).
    expect(() => new Function(script)).not.toThrow();
  });
});
