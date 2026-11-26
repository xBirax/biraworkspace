import fs from "node:fs";
import path from "node:path";
import type { SafeStorage } from "electron";
import { writeDurableFile } from "@adr/app-state";

/**
 * Histórico do Bira Browser e as abas abertas (para reabrir o app onde estava).
 *
 * Gravado no disco, CRIPTOGRAFADO pelo sistema (DPAPI no Windows, como o Cofre
 * ADR); sem criptografia disponível fica só em memória — histórico em texto
 * puro no perfil, nunca. E nunca entram páginas de login nem endereços com
 * código/token na URL: era por elas que a navegação ficava só em memória.
 */

export const HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const HISTORY_MAX_ENTRIES = 5000;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 300;

export type HistoryEntry = {
  url: string;
  title: string;
  lastVisitedAt: number;
  visitCount: number;
};

export type SessionTab = { url: string; title: string };

type HistoryPayload = {
  version: 1;
  entries: HistoryEntry[];
  tabs: Record<string, SessionTab>;
};

/** Hosts de login conhecidos (o resto cai na regra do primeiro rótulo). */
const LOGIN_HOSTS = new Set([
  "accounts.google.com",
  "appleid.apple.com",
  "login.microsoftonline.com",
  "login.live.com",
  "account.live.com",
  "id.atlassian.com",
  "auth.openai.com",
  "accounts.x.ai",
]);

/** auth.x.com, login.x.com, sso.x.com… — subdomínio dedicado a entrar. */
const LOGIN_LABELS = new Set(["accounts", "auth", "login", "signin", "sso", "identity", "oauth"]);

/** Parâmetros que carregam credencial ou prova de login. */
const SENSITIVE_PARAMS = new Set([
  "code",
  "token",
  "access_token",
  "id_token",
  "refresh_token",
  "auth_token",
  "oauth_token",
  "oauth_verifier",
  "state",
  "session",
  "sessionid",
  "sid",
  "password",
  "pass",
  "pwd",
  "secret",
  "client_secret",
  "signature",
  "sig",
  "otp",
  "ticket",
  "jwt",
  "apikey",
  "api_key",
  "key",
]);

function hasSensitiveParams(params: URLSearchParams): boolean {
  for (const name of params.keys()) {
    if (SENSITIVE_PARAMS.has(name.toLowerCase())) return true;
  }
  return false;
}

/**
 * Pode entrar no histórico (e na restauração das abas)? Só http(s) sem
 * usuário/senha embutidos, fora de página de login e sem parâmetro de
 * credencial — nem na query nem no fragmento (`#access_token=` do OAuth).
 */
export function isRecordableUrl(raw: string): boolean {
  if (!raw || raw.length > MAX_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (LOGIN_HOSTS.has(host)) return false;
  if (LOGIN_LABELS.has(host.split(".")[0] ?? "")) return false;
  if (/\/(login|signin|sign-in|logon|oauth2?|authorize)(\/|$)/i.test(url.pathname)) return false;
  if (hasSensitiveParams(url.searchParams)) return false;
  if (url.hash.includes("=") && hasSensitiveParams(new URLSearchParams(url.hash.slice(1)))) {
    return false;
  }
  return true;
}

function cleanTitle(title: string, url: string): string {
  const text = title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
  return text && text !== url ? text : "";
}

/** Uma entrada por endereço: a visita nova sobe para o topo e soma uma visita. */
export function recordVisit(
  entries: readonly HistoryEntry[],
  visit: { url: string; title: string },
  now: number,
): HistoryEntry[] {
  if (!isRecordableUrl(visit.url)) return [...entries];
  const previous = entries.find((entry) => entry.url === visit.url);
  const title = cleanTitle(visit.title, visit.url) || previous?.title || "";
  const next: HistoryEntry = {
    url: visit.url,
    title,
    lastVisitedAt: now,
    visitCount: (previous?.visitCount ?? 0) + 1,
  };
  return pruneHistory([next, ...entries.filter((entry) => entry.url !== visit.url)], now);
}

/** O título chega depois da navegação: atualiza sem contar visita nova. */
export function updateHistoryTitle(
  entries: readonly HistoryEntry[],
  url: string,
  title: string,
): HistoryEntry[] {
  const text = cleanTitle(title, url);
  if (!text) return [...entries];
  return entries.map((entry) => (entry.url === url ? { ...entry, title: text } : entry));
}

/** Mais de 90 dias sai; acima do teto, saem as mais antigas. */
export function pruneHistory(entries: readonly HistoryEntry[], now: number): HistoryEntry[] {
  return entries
    .filter((entry) => now - entry.lastVisitedAt <= HISTORY_RETENTION_MS)
    .sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
    .slice(0, HISTORY_MAX_ENTRIES);
}

const fold = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Busca por título e endereço, sem acento e sem diferenciar maiúscula; cada
 * palavra digitada tem de aparecer. Mais recentes primeiro.
 */
export function searchHistory(
  entries: readonly HistoryEntry[],
  query: string,
  limit = 300,
): HistoryEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hits = words.length
    ? entries.filter((entry) => {
        const haystack = fold(`${entry.title} ${entry.url}`);
        return words.every((word) => haystack.includes(word));
      })
    : entries;
  return hits.slice(0, limit);
}

function isEntry(value: unknown): value is HistoryEntry {
  const entry = value as Partial<HistoryEntry> | null;
  return Boolean(
    entry &&
    typeof entry.url === "string" &&
    typeof entry.title === "string" &&
    typeof entry.lastVisitedAt === "number" &&
    typeof entry.visitCount === "number" &&
    isRecordableUrl(entry.url),
  );
}

function isTab(value: unknown): value is SessionTab {
  const tab = value as Partial<SessionTab> | null;
  return Boolean(
    tab && typeof tab.url === "string" && typeof tab.title === "string" && isRecordableUrl(tab.url),
  );
}

type Storage = Pick<SafeStorage, "isEncryptionAvailable" | "encryptString" | "decryptString">;

export class BrowserHistoryStore {
  private entries: HistoryEntry[] = [];
  private tabsById: Record<string, SessionTab> = {};
  private loaded = false;
  private unreadableRaw: string | undefined;
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly filePath: string,
    private readonly storage: Storage,
    private readonly now: () => number = Date.now,
    private readonly saveDelayMs = 3000,
  ) {}

  /** Grava no disco? Sem criptografia do sistema, não (fica só em memória). */
  persistent(): boolean {
    try {
      return this.storage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.persistent() || !fs.existsSync(this.filePath)) return;
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch {
      // Arquivo preso agora (antivírus): tenta de novo depois, e até lá não grava —
      // o flush com a lista vazia apagava o histórico bom.
      this.loaded = false;
      return;
    }
    try {
      const wrapper = JSON.parse(raw) as {
        ciphertext?: unknown;
      };
      if (typeof wrapper.ciphertext !== "string") throw new Error("Histórico sem conteúdo cifrado");
      const payload = JSON.parse(
        this.storage.decryptString(Buffer.from(wrapper.ciphertext, "base64")),
      ) as Partial<HistoryPayload>;
      this.entries = pruneHistory(
        Array.isArray(payload.entries) ? payload.entries.filter(isEntry) : [],
        this.now(),
      );
      for (const [id, tab] of Object.entries(payload.tabs ?? {})) {
        if (isTab(tab)) this.tabsById[id] = { url: tab.url, title: cleanTitle(tab.title, tab.url) };
      }
    } catch {
      // Arquivo ilegível (outra conta do Windows, corrompido): começa vazio.
      this.entries = [];
      this.tabsById = {};
      this.unreadableRaw = raw;
    }
  }

  private scheduleSave(): void {
    if (!this.persistent()) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), this.saveDelayMs);
    this.saveTimer.unref?.();
  }

  /** Grava já (fechamento do app). Falha de disco não derruba quem chamou. */
  flush(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (!this.loaded || !this.persistent()) return;
    try {
      const payload: HistoryPayload = { version: 1, entries: this.entries, tabs: this.tabsById };
      const ciphertext = this.storage.encryptString(JSON.stringify(payload)).toString("base64");
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      if (this.unreadableRaw !== undefined) {
        fs.writeFileSync(`${this.filePath}.unreadable-${Date.now()}-${process.pid}`, this.unreadableRaw, { flag: "wx" });
        this.unreadableRaw = undefined;
      }
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      writeDurableFile(temporary, JSON.stringify({ version: 1, ciphertext }));
      fs.renameSync(temporary, this.filePath);
    } catch {
      // Histórico é conveniência: sem disco, segue em memória.
    }
  }

  visit(url: string, title: string): void {
    this.load();
    if (!isRecordableUrl(url)) return;
    this.entries = recordVisit(this.entries, { url, title }, this.now());
    this.scheduleSave();
  }

  title(url: string, title: string): void {
    this.load();
    const next = updateHistoryTitle(this.entries, url, title);
    if (next.some((entry, index) => entry !== this.entries[index])) {
      this.entries = next;
      this.scheduleSave();
    }
  }

  search(query: string, limit?: number): HistoryEntry[] {
    this.load();
    this.entries = pruneHistory(this.entries, this.now());
    return searchHistory(this.entries, query, limit);
  }

  remove(url: string): void {
    this.load();
    this.entries = this.entries.filter((entry) => entry.url !== url);
    this.scheduleSave();
  }

  clear(): void {
    this.load();
    this.entries = [];
    this.flush();
  }

  /**
   * Endereço da aba aberta, para reabrir o app nela. `null` = aba fechada.
   * Endereço que não pode ser gravado (login, token) não apaga o anterior: a
   * aba reabre na última página comum em que esteve.
   */
  setTab(serviceId: string, tab: SessionTab | null): void {
    this.load();
    const current = this.tabsById[serviceId];
    if (tab && !isRecordableUrl(tab.url)) return;
    if (!tab) {
      if (!current) return;
      delete this.tabsById[serviceId];
    } else {
      const next = { url: tab.url, title: cleanTitle(tab.title, tab.url) || current?.title || "" };
      if (current && current.url === next.url && current.title === next.title) return;
      this.tabsById[serviceId] = next;
    }
    this.scheduleSave();
  }

  /** Abas guardadas; as que não existem mais (`keep` falso) saem do arquivo. */
  restoreTabs(keep: (serviceId: string) => boolean): Record<string, SessionTab> {
    this.load();
    let changed = false;
    for (const id of Object.keys(this.tabsById)) {
      if (!keep(id)) {
        delete this.tabsById[id];
        changed = true;
      }
    }
    if (changed) this.scheduleSave();
    return { ...this.tabsById };
  }
}
