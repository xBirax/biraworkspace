/**
 * Registro de reunião do Meet no CRM, ao sair da chamada.
 *
 * Usa as rotas que o CRM já expõe para a sessão pessoal do workspace (as mesmas
 * do painel do WhatsApp): busca de contato e criação de atividade. A atividade
 * do CRM exige negócio OU empresa — por isso o contato escolhido precisa ter
 * empresa; sem empresa o registro é recusado com mensagem clara, em vez de o
 * CRM responder 400.
 */

export type CrmCaller = (apiPath: string, init?: RequestInit) => Promise<unknown>;

export type CrmContactMatch = {
  id: string;
  name: string;
  companyId: string | null;
  companyName: string | null;
  /** Todas as empresas do contato (principal e segunda): o CRM aceita qualquer uma. */
  companyIds: string[];
};

export function contactMatchesFrom(data: unknown): CrmContactMatch[] {
  const items = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: CrmContactMatch[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item["id"] === "string" ? item["id"] : "";
    if (!id) continue;
    // Empresa principal ou a segunda (companyId2): o CRM aceita a atividade com
    // qualquer uma das duas a que o contato pertence.
    const primary = (item["company"] ?? null) as { id?: unknown; name?: unknown } | null;
    const secondary = (item["company2"] ?? null) as { id?: unknown; name?: unknown } | null;
    // A principal sempre antes da segunda, venha como objeto ou só como id.
    const primaryId =
      (primary && typeof primary.id === "string" && primary.id) ||
      (typeof item["companyId"] === "string" && item["companyId"]) ||
      null;
    const secondaryId =
      (secondary && typeof secondary.id === "string" && secondary.id) ||
      (typeof item["companyId2"] === "string" && item["companyId2"]) ||
      null;
    const companyId = primaryId || secondaryId;
    const company = primaryId ? primary : secondaryId ? secondary : null;
    out.push({
      id,
      name: typeof item["name"] === "string" && item["name"].trim() ? item["name"].trim() : "(sem nome)",
      companyId,
      companyName: company && typeof company.name === "string" ? company.name : null,
      companyIds: [primaryId, secondaryId].filter((value): value is string => Boolean(value)),
    });
  }
  return out;
}

export async function searchCrmContacts(callCrm: CrmCaller, term: string): Promise<CrmContactMatch[]> {
  const query = term.trim();
  if (query.length < 2) return [];
  return contactMatchesFrom(
    await callCrm(`/api/crm/contacts?search=${encodeURIComponent(query)}&limit=8`),
  );
}

export type CrmDealMatch = { id: string; title: string; stage: string | null; companyId: string | null };

/** Negócios do contato (abertos primeiro), para vincular a reunião a um deles. */
export function dealMatchesFrom(data: unknown): CrmDealMatch[] {
  const items = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: Array<CrmDealMatch & { open: boolean }> = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item["id"] === "string" ? item["id"] : "";
    if (!id) continue;
    const stage = (item["stage"] ?? null) as { name?: unknown } | null;
    const number = typeof item["number"] === "number" ? `#${item["number"]} ` : "";
    const title = typeof item["title"] === "string" && item["title"].trim() ? item["title"].trim() : "(sem título)";
    out.push({
      id,
      title: `${number}${title}`.slice(0, 80),
      stage: stage && typeof stage.name === "string" ? stage.name : null,
      companyId: typeof item["companyId"] === "string" ? item["companyId"] : null,
      open: item["status"] === undefined || item["status"] === "OPEN",
    });
  }
  return out
    .sort((a, b) => Number(b.open) - Number(a.open))
    .map(({ open: _open, ...deal }) => deal);
}

/**
 * O negócio serve para este contato? O CRM confere que o contato pertence à
 * empresa da atividade (a do negócio): negócio de outra empresa daria 400
 * ("O contato selecionado não pertence à empresa informada").
 */
export function dealFitsContact(deal: CrmDealMatch, contact: CrmContactMatch): boolean {
  return !deal.companyId || contact.companyIds.includes(deal.companyId);
}

export async function dealsForContact(callCrm: CrmCaller, contactId: string): Promise<CrmDealMatch[]> {
  return dealMatchesFrom(
    await callCrm(`/api/crm/deals?contactId=${encodeURIComponent(contactId)}&pageSize=10`),
  );
}

export function meetingActivityPayload(input: {
  contact: CrmContactMatch;
  room: string;
  startedAt: number;
  durationLabel: string;
  note?: string;
  /** Negócio escolhido: a atividade entra nele (e a empresa vem do negócio). */
  deal?: CrmDealMatch | null;
}): Record<string, unknown> {
  const lines = [
    `Reunião pelo Google Meet (https://meet.google.com/${input.room}).`,
    `Duração: ${input.durationLabel}.`,
  ];
  if (input.note?.trim()) lines.push("", input.note.trim());
  return {
    type: "meeting",
    title: `Reunião com ${input.contact.name}`,
    notes: lines.join("\n"),
    dueAt: new Date(input.startedAt).toISOString(),
    contactId: input.contact.id,
    // Com negócio, a empresa é a DELE (o CRM confere as duas). O CRM não copia a
    // empresa do negócio para a atividade: sem mandá-la, a reunião não aparecia
    // na ficha da empresa. Negócio sem empresa usa a do contato.
    ...(input.deal ? { dealId: input.deal.id } : {}),
    ...((input.deal?.companyId ?? input.contact.companyId)
      ? { companyId: input.deal?.companyId ?? input.contact.companyId }
      : {}),
  };
}

/** Cria a atividade e a marca como feita (a reunião já aconteceu). */
export async function logMeetingToCrm(
  callCrm: CrmCaller,
  input: Parameters<typeof meetingActivityPayload>[0],
): Promise<{ id: string }> {
  if (!input.contact.companyId && !input.deal) {
    throw new Error("Este contato não tem empresa no CRM; vincule uma empresa para registrar a reunião.");
  }
  const created = (await callCrm("/api/crm/activities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(meetingActivityPayload(input)),
  })) as { item?: { id?: unknown } } | null;
  const id = typeof created?.item?.id === "string" ? created.item.id : "";
  if (!id) throw new Error("O CRM não devolveu a atividade criada.");
  try {
    await callCrm(`/api/crm/activities/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "DONE" }),
    });
  } catch {
    // Criada e pendente ainda é registro; o usuário conclui no CRM.
  }
  return { id };
}
