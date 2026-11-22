export type LookupContactLike = {
  id: string;
  name?: string | null;
  company?: { name?: string | null } | null;
};

function norm(s: unknown): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

const STOP = new Set([
  "brasil",
  "brazil",
  "brands",
  "group",
  "grupo",
  "ltda",
  "eireli",
  "cosmeticos",
  "cosmetics",
  "company",
  "oficial",
  "store",
  "comercio",
  "industria",
  "cn",
  "the",
  "and",
]);

function toks(s: unknown): string[] {
  return norm(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOP.has(t));
}

/** Port of background.js contact disambiguation scoring (0.12.5). */
export function scoreLookupContact(contact: LookupContactLike, name: string): number {
  const full = norm(name);
  const parts = String(name)
    .split(/[|\-–—•·/]+/)
    .map((s) => norm(s))
    .filter(Boolean);
  const person = parts[0] || full;
  const compToks = toks(parts[1] || "");
  const cn = norm(contact.name);
  const coToks = toks(contact.company && contact.company.name);
  let s = 0;
  if (cn && cn === full) s += 100;
  else if (cn && cn === person) s += 40;
  else if (person && (cn.includes(person) || person.includes(cn))) s += 15;
  if (compToks.length && coToks.some((t) => compToks.includes(t))) s += 50;
  return s;
}

export function disambiguateContacts<T extends LookupContactLike>(
  found: T[],
  name: string | undefined,
): T[] {
  if (!name || found.length <= 1) return found;
  const scored = found.map((c) => ({ c, s: scoreLookupContact(c, name) }));
  const max = Math.max(...scored.map((x) => x.s), 0);
  if (max >= 40) return scored.filter((x) => x.s === max).map((x) => x.c);
  return found;
}
