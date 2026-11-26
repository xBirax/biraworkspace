import { isGoogleAuthDomain } from "@adr/service-adapters";
import { siteOf } from "./service-navigation.js";

/** A rejection route is diagnostic evidence, not proof of its cause. */
export function isGoogleLoginRejectionUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === "https://accounts.google.com" &&
      /^\/(?:v\d+\/)?(?:signin\/rejected|lifecycle\/steps\/signin\/rejected)(?:\/|$)/i.test(
        parsed.pathname,
      )
    );
  } catch {
    return false;
  }
}

/** Keep authentication documents free of application page injections. */
export function isGoogleAccountsUrl(url: string): boolean {
  try {
    return new URL(url).origin === "https://accounts.google.com";
  } catch {
    return false;
  }
}

/**
 * Sites para onde cada serviço manda o retorno do login Google. Retorno para
 * fora dessa lista não abre a janela da conta Google do workspace: uma página
 * qualquer aberta na aba (link, redirecionamento) não pode pedir login Google
 * em nome de outro aplicativo numa janela que parece do próprio serviço.
 */
const GOOGLE_OAUTH_SITES: Record<string, readonly string[]> = {
  chatgpt: ["openai.com", "chatgpt.com"],
  claude: ["claude.ai", "anthropic.com"],
  notion: ["notion.so", "notion.com"],
  trello: ["trello.com", "atlassian.com"],
  tiktok: ["tiktok.com"],
  // Outlook/Teams não têm ponte de login: servem a isServiceOwnSite (conta
  // pessoal em live.com, Microsoft 365 indo para cloud.microsoft).
  outlook: ["office.com", "office365.com", "live.com", "cloud.microsoft"],
  teams: ["microsoft.com", "live.com", "cloud.microsoft"],
};

/**
 * O `redirect_uri` é de um site do próprio serviço?
 *
 * Por SITE (domínio registrável), não por host exato — de propósito: os hosts
 * de retorno mudam (auth.openai.com → chatgpt.com, id.atlassian.com…) e um host
 * que falte aqui traz de volta o `signin/rejected`. O risco de aceitar qualquer
 * subdomínio é pequeno: o Google só redireciona para URIs registradas no
 * `client_id`, então desviar o código exigiria registrar um subdomínio do
 * serviço num client_id de terceiro.
 */
export function isServiceOAuthRedirect(kind: string, redirectUri: string): boolean {
  try {
    return (GOOGLE_OAUTH_SITES[kind] ?? []).includes(siteOf(new URL(redirectUri).hostname));
  } catch {
    return false;
  }
}

/**
 * "Continuar com o Google" de um serviço com login próprio (ChatGPT, Claude,
 * Notion, Trello, TikTok) leva ao endpoint OAuth do Google. Na partição isolada
 * do serviço não há conta Google logada, e o Google rejeita o login de um
 * navegador embutido sem sessão (`signin/rejected`).
 *
 * Devolve o `redirect_uri` quando a URL é o começo desse fluxo, ou `null`.
 * Fluxos sem redirecionamento HTTPS (`postmessage`, esquemas de app) ficam de
 * fora: dependem de window.opener e seguem pelo popup normal.
 */
export function googleOAuthRedirectUri(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== "https://accounts.google.com") return null;
    if (!/^\/(?:o\/oauth2\/|signin\/oauth)/i.test(parsed.pathname)) return null;
    if (!parsed.searchParams.get("client_id")) return null;
    // Reautenticação silenciosa não abre janela: sem sessão ela só volta com
    // erro para o serviço, que mostra o botão de login.
    if (parsed.searchParams.get("prompt") === "none") return null;
    // form_post devolve o code no CORPO de um POST; recarregar o retorno por GET
    // na aba perderia o code. Fica no fluxo antigo.
    if (parsed.searchParams.get("response_mode") === "form_post") return null;
    const redirect = new URL(parsed.searchParams.get("redirect_uri") || "");
    if (redirect.protocol !== "https:" || redirect.username || redirect.password) return null;
    if (isGoogleAuthDomain(redirect.hostname)) return null;
    return redirect.href;
  } catch {
    return null;
  }
}

/**
 * Popup do Google Identity Services (TikTok, Claude): `redirect_uri=gis_transform`
 * e `response_mode=form_post` — o login volta por um POST para
 * accounts.google.com/gsi/transform, que entrega ao `window.opener`, não por
 * redirect. Devolve a origem do site que pediu (parâmetro `origin`), ou `null`.
 * Quem chama ainda confere se essa origem é do serviço (isServiceOAuthRedirect).
 */
export function googleGisPopupOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== "https://accounts.google.com") return null;
    if (!/^\/(?:o\/oauth2\/|signin\/oauth)/i.test(parsed.pathname)) return null;
    if (!parsed.searchParams.get("client_id")) return null;
    if (parsed.searchParams.get("redirect_uri") !== "gis_transform") return null;
    if (parsed.searchParams.get("prompt") === "none") return null;
    const origin = new URL(parsed.searchParams.get("origin") || "");
    if (origin.protocol !== "https:" || origin.username || origin.password) return null;
    if (isGoogleAuthDomain(origin.hostname)) return null;
    return origin.origin;
  } catch {
    return null;
  }
}

/** POST final do popup GIS: o Google entrega o login ao opener por aqui. */
export const GIS_TRANSFORM_URL = "https://accounts.google.com/gsi/transform";

/** Login da Microsoft: contas pessoais (live.com) e de trabalho (Entra ID). */
const MICROSOFT_LOGIN_HOSTS = new Set(["login.microsoftonline.com", "login.microsoft.com", "login.live.com"]);

/**
 * "Continuar com Microsoft" de um serviço com login próprio: o começo do OAuth
 * da Microsoft. Devolve o `redirect_uri` e se o retorno vem num POST
 * (`response_mode=form_post`, comum na Microsoft), ou `null`.
 */
export function microsoftOAuthStart(url: string): { redirectUri: string; formPost: boolean } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !MICROSOFT_LOGIN_HOSTS.has(parsed.hostname)) return null;
    if (!/\/oauth2\/(?:v2\.0\/)?authorize$|^\/oauth20_authorize\.srf$/i.test(parsed.pathname)) return null;
    if (!parsed.searchParams.get("client_id")) return null;
    if (parsed.searchParams.get("prompt") === "none") return null;
    const redirect = new URL(parsed.searchParams.get("redirect_uri") || "");
    if (redirect.protocol !== "https:" || redirect.username || redirect.password) return null;
    if (MICROSOFT_LOGIN_HOSTS.has(redirect.hostname)) return null;
    return { redirectUri: redirect.href, formPost: parsed.searchParams.get("response_mode") === "form_post" };
  } catch {
    return null;
  }
}

/**
 * Login social que a janela de contas do workspace pode assumir: de quem
 * (`provider`), para onde volta (`returnTo`: redirect_uri ou a origem do popup
 * GIS) e como volta (`mode`: redirecionamento, POST ao opener do GIS ou POST
 * ao redirect_uri). Quem chama ainda confere se `returnTo` é do serviço.
 */
export type OAuthStart = {
  provider: "google" | "microsoft";
  returnTo: string;
  mode: "redirect" | "gis" | "form_post";
};

/** Para onde vai o POST do retorno que a janela de contas tem de pegar. */
export function oauthPostPrefix(flow: OAuthStart): string {
  if (flow.mode === "gis") return GIS_TRANSFORM_URL;
  const returned = new URL(flow.returnTo);
  return `${returned.origin}${returned.pathname}`;
}

export function oauthStart(url: string): OAuthStart | null {
  const gis = googleGisPopupOrigin(url);
  if (gis) return { provider: "google", returnTo: gis, mode: "gis" };
  const google = googleOAuthRedirectUri(url);
  if (google) return { provider: "google", returnTo: google, mode: "redirect" };
  const microsoft = microsoftOAuthStart(url);
  if (!microsoft) return null;
  return {
    provider: "microsoft",
    returnTo: microsoft.redirectUri,
    mode: microsoft.formPost ? "form_post" : "redirect",
  };
}

/** A navegação chegou ao `redirect_uri` do serviço (mesma origem e caminho)? */
export function isGoogleOAuthCallback(url: string, redirectUri: string): boolean {
  try {
    const target = new URL(url);
    const expected = new URL(redirectUri);
    return (
      target.protocol === "https:" &&
      target.origin === expected.origin &&
      target.pathname === expected.pathname
    );
  } catch {
    return false;
  }
}

/**
 * A URL é do site do próprio serviço (não de uma página aberta dentro dele)?
 * `homeUrl` é a home do serviço (serviceUrl). Notificação sem pergunta e o
 * "não perturbe" de reunião valem só para o site dele; CRM, shell e Bira Browser
 * nunca são "o próprio serviço" aqui.
 */
export function isServiceOwnSite(kind: string, url: string, homeUrl: string): boolean {
  if (kind === "crm" || kind === "shell" || kind === "panel" || kind === "browser") return false;
  try {
    if (siteOf(new URL(url).hostname) === siteOf(new URL(homeUrl).hostname)) return true;
  } catch {
    return false;
  }
  // Domínios do mesmo serviço (Notion em notion.com, Trello na Atlassian…).
  return isServiceOAuthRedirect(kind, url);
}

/** Endpoint que o Chrome usa para saber quais contas Google estão logadas na sessão. */
export const GOOGLE_LIST_ACCOUNTS_URL =
  "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard";

/**
 * E-mails das contas logadas, a partir da resposta do ListAccounts:
 * `["gaia.l.a.r", [["gaia.l.a", 1, "Nome", "email@x", ...], ...]]`. Formato
 * interno do Google: lido de forma defensiva — qualquer coisa diferente vira
 * lista vazia e o menu mostra só o nome da conta do workspace.
 */
export function googleAccountEmails(body: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(body.replace(/^\)\]\}'\s*/, ""));
  } catch {
    return [];
  }
  const accounts = Array.isArray(data) ? data[1] : undefined;
  if (!Array.isArray(accounts)) return [];
  const emails: string[] = [];
  for (const account of accounts) {
    if (!Array.isArray(account)) continue;
    const email = account.find(
      (field): field is string => typeof field === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field),
    );
    if (email && !emails.includes(email.toLowerCase())) emails.push(email.toLowerCase());
  }
  return emails;
}
