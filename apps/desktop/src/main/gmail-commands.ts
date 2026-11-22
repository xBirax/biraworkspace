/**
 * Comandos do painel "ADR CRM" no Gmail, sem Electron. A checagem de origem
 * (aba do Gmail, frame principal, URL) fica no index.ts, que é a fronteira do
 * IPC; aqui chegam só pedidos já autorizados, com o CRM injetado.
 *
 * Separado porque o painel nunca montava no app (Trusted Types do Gmail
 * bloqueava o innerHTML) — estas rotas nunca tinham rodado de verdade e não
 * tinham teste. Ver gmail-commands.test.ts.
 */
export type GmailCommandDeps = {
  /** callCrmJson já presa ao workspace da aba. */
  callCrm: (apiPath: string, init?: RequestInit) => Promise<unknown>;
  /** Tradução pelo serviço do WhatsApp (translateForWorkspace). */
  translate: (text: string, target: string) => Promise<unknown>;
  openCrm: () => void;
};

type Row = Record<string, unknown>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function lookup(payload: Row, deps: GmailCommandDeps) {
  const email = String(payload["email"] || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new Error("Informe um e-mail válido.");
  const found = (await deps.callCrm(`/api/crm/contacts?email=${encodeURIComponent(email)}&limit=25`, {
    signal: AbortSignal.timeout(20_000),
  })) as { items?: Row[] } | null;
  // A busca do CRM é por trecho; só o endereço exato é "este contato". Limite
  // folgado: buscando "ana@x.com", "joana@x.com" e cia. não empurram o exato para fora.
  // 25 é o teto que o app já usa neste endpoint (busca por nome em index.ts).
  const contacts = (found?.items || [])
    .filter((entry) => String(entry["email"] || "").toLowerCase() === email)
    .slice(0, 5);
  const deals = new Map<string, Row>();
  let dealsUnavailable = false;
  // Em paralelo: em série eram três idas e voltas antes de o painel mostrar
  // qualquer coisa. A ordem dos resultados segue a dos contatos.
  const results = await Promise.allSettled(
    contacts.slice(0, 3).map(
      (contact) =>
        deps.callCrm(`/api/crm/deals?contactId=${encodeURIComponent(String(contact["id"]))}&pageSize=10`, {
          signal: AbortSignal.timeout(20_000),
        }) as Promise<{ items?: Row[] } | null>,
    ),
  );
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const deal of result.value?.items || []) if (deal["id"]) deals.set(String(deal["id"]), deal);
    } else if ((result.reason as { status?: number })?.status === 403) {
      // Sem permissão de negócios: mostra os contatos e avisa, não derruba a consulta.
      dealsUnavailable = true;
    } else {
      throw result.reason;
    }
  }
  return {
    contacts: contacts.map((entry) => ({
      id: String(entry["id"] || ""),
      name: String(entry["name"] || ""),
      email: String(entry["email"] || ""),
      company: (entry["company"] as { name?: unknown } | null)?.name || null,
    })),
    deals: [...deals.values()].slice(0, 10).map((entry) => ({
      id: String(entry["id"] || ""),
      number: entry["number"] || null,
      title: String(entry["title"] || ""),
      status: String(entry["status"] || ""),
    })),
    dealsUnavailable,
  };
}

async function assist(payload: Row, deps: GmailCommandDeps) {
  const mode = String(payload["mode"] || "");
  const language = String(payload["language"] || "");
  const tone = String(payload["tone"] || "");
  const instructions = String(payload["instructions"] || "").trim();
  const text = String(payload["text"] || "").trim();
  const subject = String(payload["subject"] || "").trim();
  if (
    !["draft", "rewrite", "translate"].includes(mode) ||
    !["en", "es"].includes(language) ||
    !["professional", "friendly", "concise"].includes(tone) ||
    instructions.length > 1200 ||
    text.length > 6000 ||
    subject.length > 200 ||
    (mode === "draft" ? !instructions : !text)
  ) {
    throw new Error("Pedido de e-mail inválido.");
  }
  const data = (await deps.callCrm("/api/gmail/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode, language, tone, instructions, text, subject }),
    signal: AbortSignal.timeout(45_000),
  })) as { body?: unknown; subject?: unknown } | null;
  // O painel mostra `body` como prévia e copia `subject`. Resposta sem corpo
  // virava "Prévia pronta" com a caixa vazia; melhor dizer que não veio texto.
  const body = typeof data?.body === "string" ? data.body.trim() : "";
  if (!body) throw new Error("O assistente não devolveu um texto. Tente novamente.");
  // Assunto acima de 200 voltaria no próximo pedido e reprovaria a validação acima.
  const subjectOut = typeof data?.subject === "string" ? data.subject.trim().slice(0, 200).trim() : "";
  return { body, ...(subjectOut ? { subject: subjectOut } : {}) };
}

export async function runGmailCommand(
  command: string,
  payload: unknown,
  deps: GmailCommandDeps,
): Promise<unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Pedido Gmail inválido.");
  }
  const input = payload as Row;
  switch (command) {
    case "gmailOpenCrm":
      deps.openCrm();
      return {};
    case "gmailLookup":
      return lookup(input, deps);
    case "gmailTranslate": {
      // E-mail recebido → português, pelo mesmo serviço de tradução do WhatsApp.
      const text = String(input["text"] || "").trim();
      if (!text || text.length > 6000) throw new Error("Texto do e-mail inválido.");
      return deps.translate(text, "pt-BR");
    }
    case "gmailAssist":
      return assist(input, deps);
    default:
      throw new Error("Ação Gmail indisponível.");
  }
}
