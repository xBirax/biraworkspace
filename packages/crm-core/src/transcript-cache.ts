export const TRANSCRIPT_CACHE_LIMIT = 200;
export const TRANSCRIPT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export function normalizeText(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTitle(value: unknown): string {
  return normalizeText(value).toLocaleLowerCase("pt-BR");
}

export function normalizeComposerText(value: unknown): string {
  return String(value || "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\u00a0", " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

export function chatKey(
  identity: { id?: string | null; phone?: string | null } | null | undefined,
  title: unknown,
): string {
  const id = String(identity?.id || "").trim();
  if (id) return `jid:${id}`;
  const phone = String(identity?.phone || "").replace(/\D/g, "");
  if (phone) return `phone:${phone}`;
  const normalizedTitle = normalizeTitle(title);
  return normalizedTitle ? `title:${normalizedTitle}` : "";
}

// Porta de titleParts/isRealName do shared.js vendorizado: o content.js chama U.titleParts
// e o shared.js do build vem daqui. Titulo so com numero nao e nome (secao 178.6).
export function isRealName(title: unknown): boolean {
  return Boolean(String(title ?? "").replace(/[\d\s+()\-.]/g, ""));
}

// "Pessoa | Empresa", "Nome - Label" -> a PESSOA e a EMPRESA separadas.
// Hifen so separa com espaco dos dois lados: "Ana-Maria Souza" e um nome so.
export function titleParts(title: unknown): { person: string; company: string } {
  const parts = String(title ?? "")
    .split(/\s*[|–—•·]\s*|\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const person = parts[0] || "";
  return {
    person: isRealName(person) ? person : "",
    company: parts.length > 1 && isRealName(parts[1]) ? (parts[1] as string) : "",
  };
}

/**
 * Mesmo texto no campo do WhatsApp, sem contar linha em branco: o Lexical
 * devolve no innerText um número de quebras diferente do que recebeu colado, e
 * a tradução de mensagem com espaçamento era sempre desfeita ("não consegui
 * substituir com segurança") como se o texto tivesse mudado.
 */
export function isSameComposerText(actual: unknown, expected: unknown): boolean {
  const lines = (value: unknown) =>
    normalizeComposerText(value)
      .split("\n")
      .filter((line) => line.trim())
      .join("\n");
  return lines(actual) === lines(expected);
}

type TranscriptEntry = { text: string; updatedAt: number };
type TranscriptCache = Record<string, TranscriptEntry>;

export function normalizeTranscriptCache(
  value: unknown,
  now: number = Date.now(),
): TranscriptCache {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, { text?: unknown; updatedAt?: unknown }>)
      : {};
  const currentTime = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const cutoff = currentTime - TRANSCRIPT_CACHE_TTL_MS;

  return Object.fromEntries(
    Object.entries(source)
      .filter(([externalId, entry]) => {
        const text = typeof entry?.text === "string" ? entry.text.trim() : "";
        const updatedAt = Number(entry?.updatedAt);
        return !!externalId.trim() && !!text && Number.isFinite(updatedAt) && updatedAt >= cutoff;
      })
      .sort((left, right) => Number(right[1]?.updatedAt) - Number(left[1]?.updatedAt))
      .slice(0, TRANSCRIPT_CACHE_LIMIT)
      .map(([externalId, entry]) => [
        externalId,
        {
          text: String(entry.text).trim().slice(0, 20_000),
          updatedAt: Number(entry.updatedAt),
        },
      ]),
  );
}

export function upsertTranscriptCache(
  value: unknown,
  externalId: unknown,
  text: unknown,
  now: number = Date.now(),
): TranscriptCache {
  const key = String(externalId || "").trim();
  const normalizedText = String(text || "").trim();
  const currentTime = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const current = normalizeTranscriptCache(value, currentTime);
  if (!key || key.length > 512 || !normalizedText) return current;

  return normalizeTranscriptCache(
    {
      ...current,
      [key]: { text: normalizedText.slice(0, 20_000), updatedAt: currentTime },
    },
    currentTime,
  );
}
