import {
  lookupContactSchema,
  lookupDealSchema,
  lookupProjectSchema,
  lookupDataSchema,
  type LookupData,
} from "@adr/contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function coerceContact(raw: unknown): unknown {
  const c = asRecord(raw);
  if (!c || c["id"] == null) return raw;
  const company = asRecord(c["company"]);
  return {
    id: String(c["id"]),
    name: String(c["name"] ?? ""),
    number: c["number"] == null ? null : String(c["number"]),
    phone: c["phone"] == null ? null : String(c["phone"]),
    company: company
      ? {
          id: String(company["id"] ?? ""),
          number: company["number"] == null ? null : String(company["number"]),
          name: String(company["name"] ?? ""),
        }
      : null,
  };
}

function coerceDeal(raw: unknown): unknown {
  const d = asRecord(raw);
  if (!d || d["id"] == null) return raw;
  const stage = asRecord(d["stage"]);
  return {
    id: String(d["id"]),
    number: d["number"] == null ? null : String(d["number"]),
    title: d["title"] == null ? null : String(d["title"]),
    status: d["status"] == null ? null : String(d["status"]),
    valueCents: typeof d["valueCents"] === "number" ? d["valueCents"] : null,
    currency: d["currency"] == null ? null : String(d["currency"]),
    ownerDisplayName:
      d["ownerDisplayName"] == null ? null : String(d["ownerDisplayName"]),
    stage: stage ? { name: stage["name"] == null ? null : String(stage["name"]) } : null,
  };
}

/** Never throws on malformed CRM payloads — drops bad rows and records warnings. */
export function sanitizeLookupResult(raw: unknown): LookupData {
  const root = asRecord(raw) || {};
  const warnings: string[] = [];
  if (Array.isArray(root["warnings"])) {
    for (const w of root["warnings"]) {
      if (typeof w === "string" && w.trim()) warnings.push(w);
    }
  }

  const contacts = [];
  for (const item of Array.isArray(root["contacts"]) ? root["contacts"] : []) {
    const parsed = lookupContactSchema.safeParse(coerceContact(item));
    // Nome OU telefone: contato importado só com telefone existe na base com
    // nome vazio. Descartá-lo fazia o painel dizer "não tem pessoa cadastrada"
    // e oferecer "Salvar pessoa" — duplicata.
    if (parsed.success && parsed.data.id && (parsed.data.name || parsed.data.phone)) {
      contacts.push(parsed.data);
    } else {
      warnings.push("contato inválido ignorado");
    }
  }

  const deals = [];
  for (const item of Array.isArray(root["deals"]) ? root["deals"] : []) {
    const parsed = lookupDealSchema.safeParse(coerceDeal(item));
    if (parsed.success && parsed.data.id) deals.push(parsed.data);
    else warnings.push("negócio inválido ignorado");
  }

  const projects = [];
  for (const item of Array.isArray(root["projects"]) ? root["projects"] : []) {
    const parsed = lookupProjectSchema.safeParse(item);
    if (parsed.success) projects.push(parsed.data);
    else warnings.push("projeto inválido ignorado");
  }

  return lookupDataSchema.parse({
    contacts: contacts.slice(0, 8),
    deals: deals.slice(0, 15),
    projects,
    warnings: [...new Set(warnings)].slice(0, 20),
  });
}

export function emptyLookupResult(warnings: string[] = []): LookupData {
  return sanitizeLookupResult({ contacts: [], deals: [], projects: [], warnings });
}
