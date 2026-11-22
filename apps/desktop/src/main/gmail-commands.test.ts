import { describe, expect, it, vi } from "vitest";
import { runGmailCommand, type GmailCommandDeps } from "./gmail-commands.js";

type Route = (init?: RequestInit) => unknown;

/** CRM falso: cada rota responde (ou lança) o que o teste pedir. */
function crm(routes: Record<string, Route>) {
  const calls: string[] = [];
  const deps: GmailCommandDeps = {
    callCrm: async (apiPath, init) => {
      calls.push(apiPath);
      const route = Object.keys(routes).find((prefix) => apiPath.startsWith(prefix));
      if (!route) throw new Error(`rota inesperada: ${apiPath}`);
      return routes[route]!(init);
    },
    translate: vi.fn(async (text: string, target: string) => ({ translatedText: `[${target}] ${text}` })),
    openCrm: vi.fn(),
  };
  return { deps, calls };
}

const httpError = (status: number) => Object.assign(new Error(`Erro ${status}`), { status });

describe("gmailLookup", () => {
  it("devolve só o contato com o e-mail exato e junta os negócios de cada um", async () => {
    const { deps, calls } = crm({
      "/api/crm/contacts": () => ({
        items: [
          { id: "c1", name: "Ana", email: "Ana@Acme.com", company: { name: "Acme" } },
          { id: "c2", name: "Ana Paula", email: "ana.paula@acme.com" },
        ],
      }),
      "/api/crm/deals?contactId=c1": () => ({ items: [{ id: "d1", number: 7, title: "Proposta", status: "open" }] }),
    });
    const result = (await runGmailCommand("gmailLookup", { email: " ana@acme.com " }, deps)) as {
      contacts: Array<{ id: string; company: unknown }>;
      deals: Array<{ id: string; number: unknown }>;
      dealsUnavailable: boolean;
    };
    expect(result.contacts).toEqual([{ id: "c1", name: "Ana", email: "Ana@Acme.com", company: "Acme" }]);
    expect(result.deals).toEqual([{ id: "d1", number: 7, title: "Proposta", status: "open" }]);
    expect(result.dealsUnavailable).toBe(false);
    expect(calls[0]).toBe("/api/crm/contacts?email=ana%40acme.com&limit=25");
  });

  it("acha o exato mesmo atrás de muitos parecidos, e devolve no máximo 5", async () => {
    const lookalikes = Array.from({ length: 20 }, (_, i) => ({ id: `j${i}`, email: `joana${i}@acme.com` }));
    const exact = Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, email: "ana@acme.com" }));
    const { deps } = crm({
      "/api/crm/contacts": () => ({ items: [...lookalikes, ...exact] }),
      "/api/crm/deals": () => ({ items: [] }),
    });
    const result = (await runGmailCommand("gmailLookup", { email: "ana@acme.com" }, deps)) as {
      contacts: Array<{ id: string }>;
    };
    expect(result.contacts.map((contact) => contact.id)).toEqual(["a0", "a1", "a2", "a3", "a4"]);
  });

  it("403 nos negócios de um contato não derruba a consulta: mostra o resto e avisa", async () => {
    const { deps } = crm({
      "/api/crm/contacts": () => ({
        items: [
          { id: "c1", email: "x@y.com" },
          { id: "c2", email: "x@y.com" },
        ],
      }),
      "/api/crm/deals?contactId=c1": () => {
        throw httpError(403);
      },
      "/api/crm/deals?contactId=c2": () => ({ items: [{ id: "d2", title: "Outro" }] }),
    });
    const result = (await runGmailCommand("gmailLookup", { email: "x@y.com" }, deps)) as {
      deals: Array<{ id: string }>;
      dealsUnavailable: boolean;
    };
    expect(result.dealsUnavailable).toBe(true);
    expect(result.deals.map((deal) => deal.id)).toEqual(["d2"]);
  });

  it("outro erro nos negócios sobe (não vira 'nenhum negócio')", async () => {
    const { deps } = crm({
      "/api/crm/contacts": () => ({ items: [{ id: "c1", email: "x@y.com" }] }),
      "/api/crm/deals": () => {
        throw httpError(500);
      },
    });
    await expect(runGmailCommand("gmailLookup", { email: "x@y.com" }, deps)).rejects.toMatchObject({ status: 500 });
  });

  it("resposta sem `items` vira lista vazia, e e-mail inválido nem chega ao CRM", async () => {
    const { deps, calls } = crm({ "/api/crm/contacts": () => null });
    await expect(runGmailCommand("gmailLookup", { email: "x@y.com" }, deps)).resolves.toMatchObject({
      contacts: [],
      deals: [],
    });
    await expect(runGmailCommand("gmailLookup", { email: "nao-e-email" }, deps)).rejects.toThrow("e-mail válido");
    expect(calls).toHaveLength(1);
  });
});

describe("gmailTranslate", () => {
  it("traduz para português pelo serviço do WhatsApp", async () => {
    const { deps } = crm({});
    await expect(runGmailCommand("gmailTranslate", { text: " Hello " }, deps)).resolves.toEqual({
      translatedText: "[pt-BR] Hello",
    });
  });

  it("recusa texto vazio ou acima de 6.000 caracteres", async () => {
    const { deps } = crm({});
    await expect(runGmailCommand("gmailTranslate", { text: "   " }, deps)).rejects.toThrow("inválido");
    await expect(runGmailCommand("gmailTranslate", { text: "a".repeat(6001) }, deps)).rejects.toThrow("inválido");
    expect(deps.translate).not.toHaveBeenCalled();
  });
});

describe("gmailAssist", () => {
  const draft = { mode: "draft", language: "en", tone: "friendly", instructions: "Agradecer a reunião" };

  it("devolve corpo e assunto do assistente", async () => {
    const { deps } = crm({ "/api/gmail/assistant": () => ({ body: " Thanks! ", subject: " Meeting " }) });
    await expect(runGmailCommand("gmailAssist", draft, deps)).resolves.toEqual({ body: "Thanks!", subject: "Meeting" });
  });

  it("corta assunto acima de 200: senão o próximo pedido com ele reprovaria", async () => {
    const { deps } = crm({ "/api/gmail/assistant": () => ({ body: "Hi", subject: "S".repeat(250) }) });
    const result = (await runGmailCommand("gmailAssist", draft, deps)) as { subject: string };
    expect(result.subject).toHaveLength(200);
    await expect(runGmailCommand("gmailAssist", { ...draft, subject: result.subject }, deps)).resolves.toBeTruthy();
  });

  it("resposta sem corpo vira erro claro, não uma prévia vazia", async () => {
    const { deps } = crm({ "/api/gmail/assistant": () => ({ subject: "Só assunto" }) });
    await expect(runGmailCommand("gmailAssist", draft, deps)).rejects.toThrow("não devolveu um texto");
  });

  it("valida modo, idioma, tom e o texto exigido por cada modo antes de chamar o CRM", async () => {
    const { deps, calls } = crm({ "/api/gmail/assistant": () => ({ body: "ok" }) });
    for (const bad of [
      { ...draft, mode: "spam" },
      { ...draft, language: "fr" },
      { ...draft, tone: "rude" },
      { ...draft, instructions: "" },
      { mode: "rewrite", language: "es", tone: "concise", text: "" },
      { ...draft, instructions: "x".repeat(1201) },
    ]) {
      await expect(runGmailCommand("gmailAssist", bad, deps)).rejects.toThrow("Pedido de e-mail inválido");
    }
    expect(calls).toHaveLength(0);
  });
});

describe("runGmailCommand", () => {
  it("abre o CRM, recusa comando desconhecido e payload que não é objeto", async () => {
    const { deps } = crm({});
    await expect(runGmailCommand("gmailOpenCrm", {}, deps)).resolves.toEqual({});
    expect(deps.openCrm).toHaveBeenCalledOnce();
    await expect(runGmailCommand("gmailDelete", {}, deps)).rejects.toThrow("indisponível");
    await expect(runGmailCommand("gmailLookup", ["x"], deps)).rejects.toThrow("Pedido Gmail inválido");
  });
});
