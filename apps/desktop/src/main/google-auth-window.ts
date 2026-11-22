import { BrowserWindow, session, type BaseWindow, type WebContents } from "electron";
import { assertSafePartitionName } from "@adr/partitions";
import { isAllowedExternalUrl } from "./url-allowlist.js";
import {
  GOOGLE_LIST_ACCOUNTS_URL,
  googleAccountEmails,
  isGoogleLoginRejectionUrl,
  isGoogleOAuthCallback,
  isServiceOAuthRedirect,
  oauthPostPrefix,
  type OAuthStart,
} from "./chrome-session.js";
import { popupChoice } from "./popup-choice.js";

/**
 * "Continuar com o Google" nos serviços de login próprio (ChatGPT, Claude,
 * Notion, Trello, TikTok).
 *
 * A aba do serviço tem partição isolada, sem conta Google, e o Google rejeita
 * esse login (`signin/rejected`). Aqui a etapa do Google roda numa janela numa
 * partição Google do workspace — a do Gmail, com as contas já logadas — e só o
 * retorno (`redirect_uri` com code/state) volta para `target` (a aba, ou o popup
 * de login dela), que guarda os cookies de estado do serviço e conclui o login.
 *
 * "Continuar com Microsoft" usa a mesma janela, numa partição de conta
 * Microsoft do workspace (a do Outlook/Teams), para aproveitar o login já feito.
 *
 * Saiu de workspace-window.ts: depende só do que recebe em `deps`.
 */

/** `detail`: o que mais identifica a conta no menu (Microsoft: os serviços que a usam). */
export type GoogleAccountChoice = { id: string; name: string; partitionName: string; detail?: string };

export type GoogleAuthBridgeDeps = {
  parentWindow: BaseWindow;
  viewMeta: WeakMap<WebContents, { kind: string; workspaceId: string; serviceId?: string }>;
  /** A aba está na frente? Pedido de aba no fundo não abre janela. */
  isFrontView: (contents: WebContents) => boolean;
  /** Contas Google (partições) do workspace, na ordem da barra lateral. */
  googleAccounts: (workspaceId: string) => GoogleAccountChoice[];
  /** Contas Microsoft (partições) do workspace. */
  microsoftAccounts: (workspaceId: string) => GoogleAccountChoice[];
  /** Garante a política de permissões da partição (pode ainda não ter aba). */
  ensureSessionPolicy: (ses: Electron.Session, partitionName: string, oauthUrl: string) => void;
  openExternal: (url: string) => void;
  log: (message: string, extra?: unknown) => void;
  /**
   * "Outra conta…": entrar com ela primeiro no Gmail do workspace (login direto,
   * que o Google aceita aqui) e voltar a clicar em "Continuar com o Google".
   */
  addGoogleAccount: (workspaceId: string) => void;
  /** O Google recusou o login na janela: orientar em vez de deixar a página crua. */
  onLoginRejected: (kind: string, returnHost: string) => void;
};

export type GoogleAuthHooks = { onCancel?: () => void; onDelivered?: () => void };

const PROVIDER_NAME = { google: "o Google", microsoft: "a Microsoft" } as const;

/**
 * Login que volta num POST (`mode` "gis" ou "form_post"): o POST para `prefix`
 * é pego aqui (CDP Fetch: o webRequest da sessão já é do bloqueador de
 * anúncios), abortado e entregue a `onPost` para ser refeito em `target`. No
 * GIS só o popup do serviço tem o `window.opener` que recebe o login; no
 * form_post só a partição do serviço tem os cookies de estado dele.
 */
function interceptPost(
  contents: WebContents,
  prefix: string,
  onPost: (url: string, body: Buffer, contentType: string, referrer?: string) => void,
): boolean {
  const cdp = contents.debugger;
  try {
    cdp.attach("1.3");
  } catch {
    return false;
  }
  type Paused = {
    requestId: string;
    resourceType?: string;
    request: {
      url: string;
      method: string;
      headers: Record<string, string>;
      postData?: string;
      postDataEntries?: Array<{ bytes?: string }>;
    };
  };
  cdp.on("message", (_event, method: string, params: Paused) => {
    if (method !== "Fetch.requestPaused") return;
    const { requestId, request } = params;
    const parts = request.postDataEntries?.map((part) => Buffer.from(part.bytes ?? "", "base64"));
    const body = parts?.length
      ? Buffer.concat(parts)
      : request.postData !== undefined
        ? Buffer.from(request.postData)
        : null;
    if (params.resourceType !== "Document" || request.method !== "POST" || !body) {
      void cdp.sendCommand("Fetch.continueRequest", { requestId }).catch(() => undefined);
      return;
    }
    void cdp
      .sendCommand("Fetch.failRequest", { requestId, errorReason: "Aborted" })
      .catch(() => undefined);
    const header = (wanted: string): string | undefined =>
      Object.entries(request.headers).find(([name]) => name.toLowerCase() === wanted)?.[1];
    // Vai para extraHeaders: quebra de linha nunca.
    const contentType = (header("content-type") ?? "application/x-www-form-urlencoded").replace(/[\r\n]/g, "");
    // O POST refeito leva o Referer do original (a página do Google/Microsoft):
    // callback que confere de onde veio o retorno não o recusa.
    onPost(request.url, body, contentType, header("referer"));
  });
  void cdp
    .sendCommand("Fetch.enable", { patterns: [{ urlPattern: `${prefix}*`, requestStage: "Request" }] })
    .catch(() => undefined);
  return true;
}

export function createGoogleAuthBridge(deps: GoogleAuthBridgeDeps) {
  /** Janela aberta por cada aba de serviço (a dona). */
  const windows = new WeakMap<WebContents, BrowserWindow>();
  /** Fechadas porque um clique novo reiniciou o login (não é cancelamento). */
  const superseded = new WeakSet<BrowserWindow>();
  /** Para quem cada janela devolveria o login, e o que fazer ao cancelar. */
  const flows = new WeakMap<BrowserWindow, { target: WebContents; hooks: GoogleAuthHooks }>();

  const open = (
    owner: WebContents,
    target: WebContents,
    workspaceId: string,
    kind: string,
    partitionName: string,
    oauthUrl: string,
    flow: OAuthStart,
    hooks: GoogleAuthHooks,
  ): void => {
    assertSafePartitionName(partitionName);
    const { returnTo: redirectUri, mode, provider } = flow;
    const who = PROVIDER_NAME[provider];
    // Clicar de novo reinicia o fluxo: o serviço acabou de gravar um state novo,
    // e a janela antiga devolveria o velho (login recusado). Substituída, não
    // cancelada: o "closed" dela não pode fechar o popup que esta vai usar.
    const previous = windows.get(owner);
    if (previous && !previous.isDestroyed()) {
      superseded.add(previous);
      // Outro alvo (popup novo): o popup escondido do login antigo não volta a
      // ser usado — cancela o fluxo dele. Mesmo alvo: o fluxo novo o reaproveita.
      const old = flows.get(previous);
      if (old && old.target !== target) old.hooks.onCancel?.();
      previous.close();
    }
    if (owner.isDestroyed() || target.isDestroyed()) return;
    deps.ensureSessionPolicy(session.fromPartition(partitionName), partitionName, oauthUrl);
    let returnHost = "";
    try {
      returnHost = new URL(redirectUri).hostname;
    } catch {
      /* validado em googleOAuthRedirectUri */
    }
    const authWin = new BrowserWindow({
      parent: deps.parentWindow,
      width: 520,
      height: 720,
      autoHideMenuBar: true,
      // Sem barra de endereço: o título diz para onde o login volta.
      title: `Entrar com ${who} — ${returnHost}`,
      webPreferences: {
        partition: partitionName,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    authWin.on("page-title-updated", (event) => event.preventDefault());
    deps.viewMeta.set(authWin.webContents, { kind: "browser", workspaceId });
    windows.set(owner, authWin);
    flows.set(authWin, { target, hooks });
    // Sem barra de endereço: fora do Google (SSO de empresa, página qualquer
    // a partir do login), o título passa a dizer em que site a janela está.
    authWin.webContents.on("did-navigate", (_event, url) => {
      if (authWin.isDestroyed()) return;
      if (isGoogleLoginRejectionUrl(url)) deps.onLoginRejected(kind, returnHost);
      let host = "";
      try {
        host = new URL(url).hostname;
      } catch {
        return;
      }
      const own =
        provider === "google"
          ? host === "google.com" || host.endsWith(".google.com")
          : /(^|\.)(microsoftonline\.com|microsoft\.com|live\.com)$/.test(host);
      authWin.setTitle(
        own ? `Entrar com ${who} — ${returnHost}` : `Entrar com ${who} — página de ${host} (volta para ${returnHost})`,
      );
    });
    let delivered = false;
    const handOff = (load: () => Promise<void>): void => {
      if (delivered) return;
      delivered = true;
      if (!target.isDestroyed()) {
        void load().catch(() => undefined);
        hooks.onDelivered?.();
      }
      if (!authWin.isDestroyed()) authWin.close();
    };
    if (mode !== "redirect") {
      // O serviço refaz o POST: o popup (GIS) tem o opener; a partição dele, o state.
      const hooked = interceptPost(authWin.webContents, oauthPostPrefix(flow), (url, body, contentType, referrer) =>
        handOff(() =>
          target.loadURL(url, {
            postData: [{ type: "rawData", bytes: body }],
            extraHeaders: `Content-Type: ${contentType}`,
            ...(referrer ? { httpReferrer: referrer } : {}),
          }),
        ),
      );
      if (!hooked) deps.log("oauth post bridge unavailable", { service: kind, mode });
    } else {
      const deliver = (event: { url: string; isMainFrame: boolean; preventDefault: () => void }): void => {
        if (!event.isMainFrame || !isGoogleOAuthCallback(event.url, redirectUri)) return;
        // O retorno não carrega nesta partição: o state do serviço está na aba.
        event.preventDefault();
        handOff(() => target.loadURL(event.url));
      };
      authWin.webContents.on("will-redirect", deliver);
      authWin.webContents.on("will-navigate", deliver);
    }
    // Link da tela de consentimento (privacidade, termos do app) vai para o
    // navegador — mas só com esta janela em foco e um por vez a cada 1,5 s: uma
    // página qualquer alcançada daqui não pode abrir o navegador em laço.
    let lastExternalAt = 0;
    authWin.webContents.setWindowOpenHandler(({ url }) => {
      const now = Date.now();
      if (isAllowedExternalUrl(url) && authWin.isFocused() && now - lastExternalAt >= 1500) {
        lastExternalAt = now;
        deps.openExternal(url);
      }
      return { action: "deny" };
    });
    const closeWithService = (): void => {
      if (!authWin.isDestroyed()) authWin.close();
    };
    owner.once("destroyed", closeWithService);
    if (target !== owner) target.once("destroyed", closeWithService);
    authWin.once("closed", () => {
      if (!owner.isDestroyed()) owner.removeListener("destroyed", closeWithService);
      if (!target.isDestroyed()) target.removeListener("destroyed", closeWithService);
      if (windows.get(owner) === authWin) windows.delete(owner);
      if (!delivered && !superseded.has(authWin)) hooks.onCancel?.();
    });
    deps.log("oauth in workspace session", { service: kind, host: returnHost, mode, provider });
    void authWin.loadURL(oauthUrl).catch(() => undefined);
  };

  /**
   * Devolve false — e o fluxo antigo segue, na própria aba — quando o workspace
   * não tem conta do provedor, quando o retorno não é de um site do serviço, ou
   * quando a aba não está na frente (pedido sem o usuário olhando). Com mais de
   * uma conta no workspace, pergunta qual usar.
   */
  const signIn = (
    owner: WebContents,
    target: WebContents,
    oauthUrl: string,
    flow: OAuthStart,
    hooks: GoogleAuthHooks = {},
  ): boolean => {
    const meta = deps.viewMeta.get(owner);
    if (!meta || !deps.isFrontView(owner)) return false;
    if (!isServiceOAuthRedirect(meta.kind, flow.returnTo)) return false;
    const accounts =
      flow.provider === "google" ? deps.googleAccounts(meta.workspaceId) : deps.microsoftAccounts(meta.workspaceId);
    if (!accounts.length) return false;
    const start = (account: GoogleAccountChoice): void =>
      open(owner, target, meta.workspaceId, meta.kind, account.partitionName, oauthUrl, flow, hooks);
    if (accounts.length === 1) {
      // Uma sessão: o seletor de conta do próprio Google/Microsoft já mostra as
      // contas logadas nela (e "Usar outra conta").
      start(accounts[0]!);
      return true;
    }
    // Segundo clique em "Continuar com o Google" com o menu ainda por vir: o
    // primeiro segue; este desiste (fecha o próprio popup). Dois seletores ao
    // mesmo tempo faziam o cancelamento do primeiro fechar o popup do segundo.
    if (choosing.has(owner)) {
      setTimeout(() => hooks.onCancel?.(), 0);
      return true;
    }
    choosing.add(owner);
    void chooseAccount(owner, accounts, meta.workspaceId, flow.provider, start, hooks).finally(() =>
      choosing.delete(owner),
    );
    return true;
  };

  /** Abas com o menu de contas em andamento. */
  const choosing = new WeakSet<WebContents>();
  /** E-mails por partição, por 60 s: o segundo login seguido não espera de novo. */
  const emailCache = new Map<string, { at: number; emails: string[] }>();

  /** E-mails logados numa partição Google (vazio se não der para saber em 2,5 s). */
  async function emailsOf(partitionName: string): Promise<string[]> {
    const cached = emailCache.get(partitionName);
    if (cached && Date.now() - cached.at < 60_000) return cached.emails;
    try {
      const response = await session.fromPartition(partitionName).fetch(GOOGLE_LIST_ACCOUNTS_URL, {
        method: "POST",
        credentials: "include",
        signal: AbortSignal.timeout(2500),
      });
      const emails = response.ok ? googleAccountEmails(await response.text()) : [];
      if (emails.length) emailCache.set(partitionName, { at: Date.now(), emails });
      return emails;
    } catch {
      return [];
    }
  }

  /**
   * Menu com cada conta Google do workspace pelo E-MAIL (o nome do perfil —
   * "Google", "Gmail 2" — não dizia qual era qual) e "Outra conta…". Contas
   * Microsoft vão pelo nome (renomeável em Perfil e contas) e sem "Outra
   * conta…": o seletor da Microsoft já tem "Usar outra conta".
   */
  async function chooseAccount(
    owner: WebContents,
    accounts: GoogleAccountChoice[],
    workspaceId: string,
    provider: OAuthStart["provider"],
    start: (account: GoogleAccountChoice) => void,
    hooks: GoogleAuthHooks,
  ): Promise<void> {
    const google = provider === "google";
    const emails = google ? await Promise.all(accounts.map((account) => emailsOf(account.partitionName))) : [];
    // Até 2,5 s de espera: se nesse meio-tempo o usuário trocou de aba ou fechou
    // o app, o menu não aparece por cima de outra coisa.
    if (owner.isDestroyed() || deps.parentWindow.isDestroyed() || !deps.isFrontView(owner)) {
      hooks.onCancel?.();
      return;
    }
    // Uma resposta só: clique depois do prazo de fechamento é ignorado (senão
    // o popup de login fechava e a janela da conta abria logo em seguida).
    const picked = await popupChoice<GoogleAccountChoice | "other">(deps.parentWindow, [
      { header: google ? "Entrar com qual conta Google?" : "Entrar com qual conta Microsoft?" },
      { separator: true },
      ...accounts.map((account, index) =>
        emails[index]?.length
          ? { label: emails[index]!.join(", "), sublabel: account.name, value: account }
          : { label: account.name, ...(account.detail ? { sublabel: account.detail } : {}), value: account },
      ),
      { separator: true },
      ...(google ? [{ label: "Outra conta… (entrar primeiro pelo Gmail)", value: "other" as const }] : []),
      { label: "Cancelar", cancel: true },
    ]);
    if (picked === undefined || picked === "other") hooks.onCancel?.();
    if (picked === "other") deps.addGoogleAccount(workspaceId);
    else if (picked) start(picked);
  }

  /** Login em andamento para esta aba (a aba não deve hibernar no meio). */
  const isOpenFor = (contents: WebContents): boolean => {
    const authWin = windows.get(contents);
    return Boolean(authWin && !authWin.isDestroyed());
  };

  return { signIn, isOpenFor };
}
