import { randomUUID } from "node:crypto";

export const MAX_PASSWORD_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_PASSWORD_ENTRIES = 10_000;

export type VaultEntry = {
  id: string;
  origin: string;
  username: string;
  password: string;
  name?: string;
  /** Veio da sincronização com o Bitwarden: some do Cofre quando sumir de lá. */
  source?: "bitwarden";
  /** Só o próprio host, sem subdomínios (URI "host/exato/começa com" no Bitwarden). */
  exactOrigin?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type VaultEntryMeta = Omit<VaultEntry, "password"> & { hostname: string };

export type ParsedPasswordCsv = {
  entries: Array<Pick<VaultEntry, "origin" | "username" | "password" | "name" | "exactOrigin">>;
  skipped: number;
};

function normalizedHeader(value: string): string {
  return value.trim().replace(/^\uFEFF/, "").toLowerCase();
}

export function normalizeVaultOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * A credencial salva para `entryOrigin` vale na página `pageUrl`?
 * 2 = mesma origem; 1 = subdomínio do site salvo (login de `example.com` em
 * `app.example.com`, com `www.` valendo como o domínio); 0 = não.
 *
 * Só do site salvo para os subdomínios dele, nunca entre "irmãos": sem a
 * Public Suffix List, juntar pelo domínio-base poria a senha de
 * `fulano.github.io` em `ciclano.github.io`. Mesma porta; login salvo em
 * http vale no https do mesmo site (o site migrou), https nunca vai para http.
 * `exact` (match "host/exato" do Bitwarden): só o próprio host, sem subdomínios.
 */
export function vaultOriginMatch(entryOrigin: string, pageUrl: string, exact = false): 0 | 1 | 2 {
  let entry: URL;
  let page: URL;
  try {
    entry = new URL(entryOrigin);
    page = new URL(pageUrl);
  } catch {
    return 0;
  }
  if (page.protocol !== "https:" && page.protocol !== "http:") return 0;
  const upgrade = entry.protocol === "http:" && page.protocol === "https:";
  if ((entry.protocol !== page.protocol && !upgrade) || entry.port !== page.port) return 0;
  if (entry.hostname === page.hostname) return upgrade ? 1 : 2;
  if (exact) return 0;
  const saved = entry.hostname.replace(/^www\./, "");
  // Rótulo único ou sufixo público ("com.br", vindo de um CSV ou do Bitwarden)
  // casaria com qualquer site abaixo dele: aí só o próprio host.
  if (!saved.includes(".") || /^(com|net|org|gov|edu|co)\.[a-z]{2}$/.test(saved)) return 0;
  return page.hostname === saved || page.hostname.endsWith(`.${saved}`) ? 1 : 0;
}

/** Small RFC-4180 parser; supports quoted commas, escaped quotes and line breaks. */
export function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("CSV inválido: aspas não foram fechadas");
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

// Nomes de coluna aceitos. `login_*` é a exportação CSV do Bitwarden; os demais
// são Chrome/Edge/Brave e planilhas feitas à mão.
const URL_COLUMNS = ["url", "origin", "login_uri"];
const USERNAME_COLUMNS = ["username", "user", "login", "login_username"];
const PASSWORD_COLUMNS = ["password", "senha", "login_password"];
const NAME_COLUMNS = ["name", "title", "nome"];

/**
 * Origem do endereço da linha. O Bitwarden põe todos os endereços do login na
 * mesma célula, separados por vírgula, e guarda o que a pessoa digitou — às
 * vezes sem esquema ("exemplo.com"). Vale o primeiro endereço web; sem esquema,
 * https.
 */
function originFromCsvUrl(value: string): string | null {
  for (const candidate of value.split(",")) {
    const origin = originFromUri(candidate);
    if (origin) return origin;
  }
  return null;
}

/** Um endereço salvo pela pessoa: sem esquema vale https; só http(s) serve. */
function originFromUri(value: string): string | null {
  const uri = value.trim();
  if (!uri) return null;
  return normalizeVaultOrigin(/^[a-z][a-z0-9+.-]*:/i.test(uri) ? uri : `https://${uri}`);
}

export function parsePasswordCsv(input: string): ParsedPasswordCsv {
  const rows = parseCsvRows(input);
  const header = rows.shift()?.map(normalizedHeader) ?? [];
  const urlIndex = header.findIndex((value) => URL_COLUMNS.includes(value));
  const usernameIndex = header.findIndex((value) => USERNAME_COLUMNS.includes(value));
  const passwordIndex = header.findIndex((value) => PASSWORD_COLUMNS.includes(value));
  const nameIndex = header.findIndex((value) => NAME_COLUMNS.includes(value));

  if (urlIndex < 0 || usernameIndex < 0 || passwordIndex < 0) {
    throw new Error(
      "O CSV precisa das colunas url, username e password (ou login_uri, login_username e login_password, do Bitwarden)",
    );
  }
  if (rows.length > MAX_PASSWORD_ENTRIES) {
    throw new Error(`O CSV excede o limite de ${MAX_PASSWORD_ENTRIES} credenciais`);
  }

  const entries: ParsedPasswordCsv["entries"] = [];
  let skipped = 0;
  for (const row of rows) {
    const origin = originFromCsvUrl(row[urlIndex] || "");
    const username = (row[usernameIndex] || "").trim();
    const password = row[passwordIndex] || "";
    if (!origin || !username || !password) {
      skipped += 1;
      continue;
    }
    const name = nameIndex >= 0 ? (row[nameIndex] || "").trim() : "";
    entries.push({
      origin,
      username,
      password,
      ...(name ? { name } : {}),
    });
  }
  return { entries, skipped };
}

export function mergeVaultEntries(
  current: VaultEntry[],
  incoming: ParsedPasswordCsv,
  now = Date.now(),
): { entries: VaultEntry[]; imported: number; updated: number; skipped: number } {
  const entries = current.map((entry) => ({ ...entry }));
  const byIdentity = new Map(
    entries.map((entry, index) => [`${entry.origin}\n${entry.username}`, index]),
  );
  let imported = 0;
  let updated = 0;

  for (const candidate of incoming.entries) {
    const key = `${candidate.origin}\n${candidate.username}`;
    const existingIndex = byIdentity.get(key);
    if (existingIndex === undefined) {
      const entry: VaultEntry = {
        id: randomUUID(),
        ...candidate,
        createdAt: now,
        updatedAt: now,
      };
      byIdentity.set(key, entries.length);
      entries.push(entry);
      imported += 1;
    } else {
      const existing = entries[existingIndex]!;
      entries[existingIndex] = {
        ...existing,
        ...candidate,
        updatedAt: now,
      };
      updated += 1;
    }
  }

  return { entries, imported, updated, skipped: incoming.skipped };
}

/** Match de URI do Bitwarden: 4 = expressão regular, 5 = nunca preencher. */
const BITWARDEN_SKIP_MATCH = new Set([4, 5]);

/**
 * Itens de `bw list items` → credenciais do Cofre. Só logins (type 1) com
 * usuário e senha; cada endereço web do login vira uma entrada (o Bitwarden
 * guarda vários por item). Regex e "nunca" ficam de fora: não dá para
 * reproduzir o critério com segurança.
 */
export function bitwardenItemsToEntries(items: unknown): ParsedPasswordCsv {
  const entries: ParsedPasswordCsv["entries"] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of Array.isArray(items) ? items : []) {
    const item = raw as {
      type?: unknown;
      name?: unknown;
      login?: { username?: unknown; password?: unknown; uris?: unknown };
    } | null;
    const username = typeof item?.login?.username === "string" ? item.login.username.trim() : "";
    const password = typeof item?.login?.password === "string" ? item.login.password : "";
    const uris = Array.isArray(item?.login?.uris) ? item.login.uris : [];
    const targets = uris
      .map((entry) => entry as { uri?: unknown; match?: unknown } | null)
      .filter((entry) => !BITWARDEN_SKIP_MATCH.has(entry?.match as number))
      .map((entry) => ({
        origin: typeof entry?.uri === "string" ? originFromUri(entry.uri) : null,
        // 1 host, 2 começa com, 3 exato: só aquele host. null/0 = domínio.
        exactOrigin: [1, 2, 3].includes(entry?.match as number),
      }))
      .filter((target): target is { origin: string; exactOrigin: boolean } =>
        Boolean(target.origin),
      );
    if (item?.type !== 1 || !username || !password || !targets.length) {
      skipped += 1;
      continue;
    }
    const name = typeof item.name === "string" ? item.name.trim() : "";
    for (const { origin, exactOrigin } of targets) {
      const key = `${origin}\n${username}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ origin, username, password, exactOrigin, ...(name ? { name } : {}) });
    }
  }
  if (entries.length > MAX_PASSWORD_ENTRIES) {
    throw new Error(`O cofre do Bitwarden excede o limite de ${MAX_PASSWORD_ENTRIES} credenciais`);
  }
  return { entries, skipped };
}

/**
 * Espelha o Bitwarden no Cofre: o que veio de lá é criado/atualizado e
 * marcado; o que veio de lá numa sincronização anterior e sumiu agora sai.
 * Credencial salva à mão ou por CSV com o mesmo site e usuário recebe a senha
 * nova, mas não é marcada — nunca é apagada por uma sincronização.
 */
export function mirrorBitwardenEntries(
  current: VaultEntry[],
  incoming: ParsedPasswordCsv,
  now = Date.now(),
): { entries: VaultEntry[]; imported: number; updated: number; removed: number } {
  const key = (entry: Pick<VaultEntry, "origin" | "username">) =>
    `${entry.origin}\n${entry.username}`;
  const before = new Map(current.map((entry) => [key(entry), entry]));
  const wanted = new Set(incoming.entries.map(key));
  const merged = mergeVaultEntries(current, incoming, now);
  const entries: VaultEntry[] = [];
  let removed = 0;
  for (const entry of merged.entries) {
    const previous = before.get(key(entry));
    if (wanted.has(key(entry))) {
      // Nova (veio agora do Bitwarden) ou já era do Bitwarden: marca.
      const fromBitwarden = !previous || previous.source === "bitwarden";
      entries.push(fromBitwarden ? { ...entry, source: "bitwarden" } : entry);
    } else if (entry.source === "bitwarden") {
      removed += 1;
    } else {
      entries.push(entry);
    }
  }
  return { entries, imported: merged.imported, updated: merged.updated, removed };
}

export function entryMeta(entry: VaultEntry): VaultEntryMeta {
  return {
    id: entry.id,
    origin: entry.origin,
    hostname: new URL(entry.origin).hostname,
    username: entry.username,
    ...(entry.name ? { name: entry.name } : {}),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}
