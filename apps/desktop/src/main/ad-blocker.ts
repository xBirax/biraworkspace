import fs from "node:fs";
import path from "node:path";
import { net, type Session } from "electron";

const FILTER_URLS = [
  "https://easylist.to/easylist/easylist.txt",
  "https://easylist.to/easylist/easyprivacy.txt",
];

const FALLBACK_DOMAINS = [
  "2mdn.net",
  "adnxs.com",
  "adsrvr.org",
  "amazon-adsystem.com",
  "criteo.com",
  "criteo.net",
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "google-analytics.com",
  "hotjar.com",
  "scorecardresearch.com",
  "taboola.com",
  "zedo.com",
];

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type AdBlockState = {
  enabled: boolean;
  siteAllowed: boolean;
  blockedCount: number;
  filterCount: number;
};

export function parseNetworkFilterDomains(text: string): Set<string> {
  const domains = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("||") || line.startsWith("@@")) continue;
    const match = /^\|\|([a-z0-9.-]+)\^(?:\$(.*))?$/i.exec(line);
    const domain = match?.[1]?.toLowerCase();
    // Só sabemos aplicar regras incondicionais. Uma regra `$domain=a.com|b.com`
    // vale apenas nesses sites; achatá-la em "bloqueie em todo lugar" derruba
    // recursos legítimos de terceiros (mídia, CDN, XHR) em sites não citados.
    if (/(^|,)~?domain=/i.test(match?.[2] || "")) continue;
    if (domain && domain.includes(".") && !domain.includes("*")) domains.add(domain);
  }
  return domains;
}

/**
 * Requisição para o próprio site (ou subdomínio dele). Nunca bloqueamos:
 * regras `$third-party` foram achatadas na leitura e, sem esta guarda, um
 * `||exemplo.com^$third-party` mata a mídia/XHR do próprio exemplo.com.
 */
export function isFirstPartyRequest(pageHostname: string, requestHostname: string): boolean {
  if (!pageHostname || !requestHostname) return false;
  return (
    pageHostname === requestHostname ||
    requestHostname.endsWith(`.${pageHostname}`) ||
    pageHostname.endsWith(`.${requestHostname}`)
  );
}

export function hostnameMatchesFilter(hostname: string, filters: ReadonlySet<string>): boolean {
  const parts = hostname.toLowerCase().replace(/\.$/, "").split(".");
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (filters.has(parts.slice(index).join("."))) return true;
  }
  return false;
}

export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export class AdBlockManager {
  private readonly attached = new WeakSet<Session>();
  private readonly counts = new Map<number, number>();
  private domains = new Set(FALLBACK_DOMAINS);
  private allowKey = "";
  private allowSet: ReadonlySet<string> = new Set();

  private cachedAllowlist(): ReadonlySet<string> {
    const allow = this.allowlist();
    const key = allow.join("\n");
    if (key !== this.allowKey) {
      this.allowKey = key;
      this.allowSet = new Set(allow);
    }
    return this.allowSet;
  }

  constructor(
    private readonly cachePath: string,
    private readonly enabled: () => boolean,
    private readonly allowlist: () => string[],
    private readonly pageUrlForWebContents: (webContentsId: number) => string,
    private readonly onBlocked?: (webContentsId: number) => void,
  ) {}

  async initialize(): Promise<void> {
    // Baixar e reparsear ~100 mil domínios a cada abertura do app não paga: as
    // listas mudam devagar. Cache fresco (<24 h) pula a rede inteira.
    if (this.loadCache() === "fresh") return;
    await this.refreshFilters().catch(() => undefined);
  }

  attach(session: Session): void {
    if (this.attached.has(session)) return;
    this.attached.add(session);
    session.webRequest.onBeforeRequest((details, callback) => {
      if (!this.enabled() || details.resourceType === "mainFrame") {
        callback({});
        return;
      }
      const pageHostname = hostnameFromUrl(
        this.pageUrlForWebContents(details.webContentsId ?? -1) || details.referrer,
      );
      if (!pageHostname || pageHostname === "accounts.google.com") {
        callback({});
        return;
      }
      // Allowlist vazia no caso comum; Set cacheado, não alocado por request.
      const allow = this.cachedAllowlist();
      if (allow.size && hostnameMatchesFilter(pageHostname, allow)) {
        callback({});
        return;
      }
      const requestHostname = hostnameFromUrl(details.url);
      if (
        !requestHostname ||
        isFirstPartyRequest(pageHostname, requestHostname) ||
        !hostnameMatchesFilter(requestHostname, this.domains)
      ) {
        callback({});
        return;
      }
      const contentsId = details.webContentsId ?? -1;
      // Ids de webContents mortos nunca eram removidos (só o da aba ativa, via
      // resetCount). Teto simples: o contador é cosmético na toolbar.
      if (this.counts.size > 200) this.counts.clear();
      this.counts.set(contentsId, (this.counts.get(contentsId) ?? 0) + 1);
      this.onBlocked?.(contentsId);
      callback({ cancel: true });
    });
  }

  stateFor(webContentsId: number, pageUrl: string): AdBlockState {
    const hostname = hostnameFromUrl(pageUrl);
    return {
      enabled: this.enabled(),
      siteAllowed: Boolean(hostname && hostnameMatchesFilter(hostname, this.cachedAllowlist())),
      blockedCount: this.counts.get(webContentsId) ?? 0,
      filterCount: this.domains.size,
    };
  }

  resetCount(webContentsId: number): void {
    this.counts.delete(webContentsId);
  }

  private loadCache(): "fresh" | "stale" {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.cachePath, "utf8")) as {
        domains?: unknown;
        updatedAt?: unknown;
      };
      if (Array.isArray(parsed.domains)) {
        const cached = parsed.domains.filter(
          (domain): domain is string => typeof domain === "string" && domain.includes("."),
        );
        if (cached.length) {
          this.domains = new Set(cached);
          const age = Date.now() - Date.parse(String(parsed.updatedAt || ""));
          if (Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS) return "fresh";
        }
      }
    } catch {
      // First run or invalid cache: keep the built-in fallback list.
    }
    return "stale";
  }

  private async refreshFilters(): Promise<void> {
    const responses = await Promise.all(
      FILTER_URLS.map(async (url) => {
        // Node's global fetch uses Undici. A large error response closed by the
        // server can trigger an uncaught parser assertion on the main process.
        // Chromium's network stack also respects the user's Windows proxy.
        const response = await net.fetch(url, {
          credentials: "omit",
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error(`filter HTTP ${response.status}`);
        }
        return response.text();
      }),
    );
    const next = new Set<string>(FALLBACK_DOMAINS);
    for (const text of responses) {
      for (const domain of parseNetworkFilterDomains(text)) next.add(domain);
    }
    if (next.size <= FALLBACK_DOMAINS.length) return;
    this.domains = next;
    fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
    fs.writeFileSync(
      this.cachePath,
      JSON.stringify({ updatedAt: new Date().toISOString(), domains: [...next] }),
      "utf8",
    );
  }
}
