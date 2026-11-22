import type { ServiceKind } from "@adr/contracts";
import { usesStandaloneLogin } from "@adr/service-adapters";
import { isAllowedExternalUrl } from "./url-allowlist.js";

const WHATSAPP_ORIGIN = "https://web.whatsapp.com";

/** "Esta view ainda está no site dela?" — url inválida (data:, about:) é não. */
export function isSameOriginAs(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

export function isWhatsAppAppUrl(url: string): boolean {
  return isSameOriginAs(url, WHATSAPP_ORIGIN);
}

/**
 * Chrome Web Store. Carregada numa view, derruba o PROCESSO PRINCIPAL do
 * Electron 44 (castLabs): crash nativo 0xc0000005 logo depois de a página
 * trocar o próprio endereço — reproduzido em 16/10 com BaseWindow +
 * WebContentsView puros, sem código do app; desligar FedCm, Prerender2 ou
 * WebAppInstallation não evita. O Chromium trata a loja como origem especial
 * do sistema de extensões, que o Electron não tem. O ADR Browser não instala
 * extensões, então a loja vai para o navegador externo e nunca é carregada.
 * Também pega o endereço escondido num redirecionador (google.com/url?q=).
 */
export function isChromeWebStoreUrl(url: string): boolean {
  try {
    const parsed = new URL(unwrapRedirectUrl(url));
    const host = parsed.hostname.toLowerCase();
    return (
      host === "chromewebstore.google.com" ||
      (host === "chrome.google.com" && /^\/webstore(\/|$)/i.test(parsed.pathname))
    );
  } catch {
    return false;
  }
}

export function shouldOpenServiceUrlExternally(kind: ServiceKind, url: string): boolean {
  if (isChromeWebStoreUrl(url)) return true;
  return kind === "whatsapp" && isAllowedExternalUrl(url) && !isWhatsAppAppUrl(url);
}

/**
 * "Continuar com Google/Apple/Microsoft" dos serviços com conta própria abre um
 * popup OAuth que devolve o resultado por `window.opener` e se fecha com
 * `window.close()`. Carregado dentro da aba, não havia opener (login parado na
 * tela do Google) e o close fechava a própria aba do serviço.
 */
const AUTH_POPUP_HOSTS = new Set([
  "accounts.google.com",
  "appleid.apple.com",
  "login.microsoftonline.com",
  "login.microsoft.com",
  "login.live.com",
  "account.live.com",
]);

/**
 * Redirecionadores que escondem o destino do link: o Gmail embrulha todo link em
 * google.com/url?q=, o Instagram em l.instagram.com/?u=, o Facebook em l.php?u=.
 * Sem desembrulhar, o link "parece" do próprio site e abriria dentro da aba.
 */
export function unwrapRedirectUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const target =
      (host === "www.google.com" || host === "google.com") && u.pathname === "/url"
        ? u.searchParams.get("q") || u.searchParams.get("url")
        : host === "l.instagram.com" || /^(l|lm)\.facebook\.com$/.test(host)
          ? u.searchParams.get("u")
          : null;
    if (!target) return url;
    const inner = new URL(target);
    return inner.protocol === "http:" || inner.protocol === "https:" ? inner.href : url;
  } catch {
    return url;
  }
}

const SECOND_LEVEL = /\.(com|net|org|gov|edu|co)\.[a-z]{2}$/;

/**
 * "Mesmo site" para decidir se um link fica na aba: domínio registrável
 * aproximado (chatgpt.com, instagram.com, exemplo.com.br). No google.com cada
 * app é um site (mail, docs, meet…): abrir o Meet a partir do Calendar é sair
 * do serviço.
 *
 * ponytail: sufixos de dois níveis por regex, não a Public Suffix List inteira;
 * um domínio exótico (ex.: blogspot.com) só faz o link abrir fora, nunca dentro.
 */
export function siteOf(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "");
  const site = h.split(".").slice(SECOND_LEVEL.test(h) ? -3 : -2).join(".");
  return site === "google.com" ? h : site;
}

/** A popup must never turn an untrusted service URL into a privileged loadURL. */
export function servicePopupDisposition(
  kind: ServiceKind,
  url: string,
  windowDisposition = "",
  currentUrl = "",
): "ignore" | "external" | "in-app" | "popup" {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "mailto:") return "external";
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    ) {
      return "ignore";
    }
    // Antes de qualquer "popup"/"in-app": janela ou aba com a loja derrubaria o app.
    if (isChromeWebStoreUrl(url)) return "external";
    if (
      usesStandaloneLogin(kind) &&
      parsed.protocol === "https:" &&
      AUTH_POPUP_HOSTS.has(parsed.hostname)
    ) {
      return "popup";
    }
    // Pedido de JANELA (window.open com tamanho/posição; o Chromium marca
    // "new-window", link com target=_blank é "foreground-tab"). É assim que todo
    // login social, pagamento e consentimento funciona em qualquer site: a página
    // espera window.opener e se fecha no fim. Carregada na aba, ficava em branco —
    // LinkedIn → "Continuar com o Google" no ADR Browser, 06/10. Regra geral, sem
    // lista de sites. WhatsApp fica de fora: link dele vai ao navegador externo.
    if (windowDisposition === "new-window" && kind !== "whatsapp") return "popup";
    // Link "em nova aba" para outro site vai ao navegador padrão: carregado na
    // aba, o usuário perdia o serviço (conversa do ChatGPT, e-mail aberto). Links
    // do próprio site e páginas de login seguem na aba. O ADR Browser é o
    // navegador do app: os links dele ficam nele.
    if (kind !== "browser" && kind !== "whatsapp" && currentUrl) {
      const target = new URL(unwrapRedirectUrl(url));
      if (!AUTH_POPUP_HOSTS.has(target.hostname)) {
        try {
          if (siteOf(target.hostname) !== siteOf(new URL(currentUrl).hostname)) return "external";
        } catch {
          // Página atual sem URL válida (about:blank): segue a regra antiga.
        }
      }
    }
    return shouldOpenServiceUrlExternally(kind, url) ? "external" : "in-app";
  } catch {
    return "ignore";
  }
}

/**
 * A view ainda está no site do serviço, ou já foi parar em outro lugar?
 *
 * Vale para as duas saídas do beco sem saída: a barra de navegação aparece, e o
 * "recarregar" passa a significar "volte para o serviço". `browser` é o ADR
 * Browser, que tem barra sempre; url vazia é view que ainda não navegou.
 */
export function serviceDriftedOffSite(
  kind: ServiceKind,
  currentUrl: string,
  homeUrl: string,
): boolean {
  if (kind === "browser") return false;
  const homes = [homeUrl, ...(OTHER_HOME_ORIGINS[kind] ?? [])];
  return Boolean(currentUrl) && !homes.some((home) => isSameOriginAs(currentUrl, home));
}

/**
 * Outros endereços da casa do serviço: Outlook e Teams de conta pessoal moram
 * em live.com, e o Microsoft 365 está mudando para cloud.microsoft. Sem isto
 * o app via esses endereços como "fora do site" e tomava os atalhos da página.
 */
const OTHER_HOME_ORIGINS: Partial<Record<ServiceKind, readonly string[]>> = {
  outlook: ["https://outlook.live.com", "https://outlook.office365.com", "https://outlook.cloud.microsoft"],
  teams: ["https://teams.live.com", "https://teams.cloud.microsoft"],
};

/**
 * Caixa de entrada do Outlook onde a conta chegou (`https://<casa>/mail/`), ou
 * `null`. Conta pessoal mora em outlook.live.com e a de empresa em
 * outlook.office.com: começar sempre no de empresa parava a conta pessoal na
 * escolha de conta a cada abertura. Quem chama guarda isto como a casa do serviço.
 */
export function outlookHomeFor(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!(OTHER_HOME_ORIGINS.outlook ?? []).concat(OUTLOOK_WORK_ORIGINS).includes(parsed.origin)) return null;
    return /^\/mail(\/|$)/.test(parsed.pathname) ? `${parsed.origin}/mail/` : null;
  } catch {
    return null;
  }
}

/** A casa padrão (serviceUrl); as outras estão em OTHER_HOME_ORIGINS. */
const OUTLOOK_WORK_ORIGINS = ["https://outlook.office.com"];

/**
 * Link de reunião do Teams, mesmo embrulhado (google.com/url, Safe Links do
 * Outlook de empresa): a URL da reunião, para abrir no Teams do workspace, ou
 * `null`. O Safe Links só é desembrulhado AQUI, para reconhecer a reunião:
 * link comum aberto no navegador segue embrulhado, para o Defender checar o clique.
 */
export function teamsMeetingTarget(url: string): string | null {
  let inner = unwrapRedirectUrl(url);
  try {
    const parsed = new URL(inner);
    if (parsed.protocol === "https:" && parsed.hostname.endsWith(".safelinks.protection.outlook.com")) {
      inner = parsed.searchParams.get("url") || inner;
    }
  } catch {
    return null;
  }
  return isTeamsMeetingUrl(inner) ? inner : null;
}

/** Link de reunião do Teams (convite no Outlook, Gmail, Agenda, WhatsApp). */
export function isTeamsMeetingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      ["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"].includes(parsed.hostname) &&
      /^\/(?:l\/meetup-join|meet)\//i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Barra de endereço do ADR Browser. Endereço local (localhost, IPv4, [IPv6],
 * com ou sem porta) vai em http, como no Chrome: roteador e servidor de dev
 * raramente têm TLS. Sem isso "192.168.0.1" virava busca no Google.
 */
export function resolveNavInput(input: string): string {
  const t = input.trim();
  if (!t) return "https://www.google.com/";
  if (/^https?:\/\//i.test(t)) return t;
  if (/^about:/i.test(t)) return t;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])(:\d{1,5})?([/?#].*)?$/i.test(t)) {
    return `http://${t}`;
  }
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(t)) return `https://${t}`;
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}

/** Restore browser pages only; error cards and external protocols are never replayed. */
export function browserRestoreUrl(startUrl: string, suspendedUrl?: string): string {
  for (const candidate of [suspendedUrl, startUrl]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (isChromeWebStoreUrl(url.href)) continue;
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password)
        return url.href;
    } catch {
      /* Try the saved start URL, then the safe home page. */
    }
  }
  return "https://www.google.com/";
}

export function browserHistorySnapshot(
  entries: Array<{ url: string; title: string }>,
  index: number,
) {
  const safe = (url: string) => browserRestoreUrl("", url) === url;
  if (!entries[index] || !safe(entries[index]!.url)) return undefined;
  const kept = entries.filter((entry) => safe(entry.url));
  return {
    // Retain navigation, not serialized form/password contents from pageState.
    entries: kept.map(({ url, title }) => ({ url, title })),
    index: entries.slice(0, index).filter((entry) => safe(entry.url)).length,
  };
}
