import {
  BaseWindow,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  screen,
  nativeImage,
  nativeTheme,
  safeStorage,
  app,
  dialog,
  Menu,
  shell,
  webContents,
  powerMonitor,
  type Input,
  type WebContents,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import {
  createEmptyAppState,
  loadAppState,
  quarantineAppStateFiles,
  saveAppStateAtomic,
  parseAppState,
} from "@adr/app-state";
import type {
  AppStateV1,
  NotificationSettings,
  ServiceInstance,
  ServiceKind,
  SidebarPosition,
  BrowserToolbarPosition,
  ExternalBrowserPreference,
} from "@adr/contracts";
import {
  normalizeAllowedBaseUrl,
  applyCrmPanelKillSwitch,
  shouldMountCrmPanel,
} from "@adr/crm-core";
import { viewKindAllowsComposerPreload, viewKindAllowsCrmPreload } from "@adr/crm-desktop-adapter";
import {
  ViewLifecycle,
  hibernateAfterMs,
  recommendedMaxLoadedViews,
  type MemoryPressure,
} from "@adr/view-lifecycle";
import os from "node:os";
import { buildExtensionInjection, resolveVendorExtensionDir } from "./extension-inject.js";
import { CrashRecoveryRegistry } from "./crash-recovery.js";
import { createHibernationController } from "./hibernation.js";
import {
  crmLoginPartition,
  crmSurfaceAllowedWithoutLogin,
  hasCrmAuthenticatedSession,
  logoutCrmWorkspace,
} from "./crm-login.js";
import {
  SERVICE_CATALOG,
  addServiceToWorkspace,
  isMessengerKind,
  messengerStaysAwake as messengerKindStaysAwake,
  duplicateServiceInWorkspace,
  ensureDefaultWorkspaceState,
} from "./service-catalog.js";
import {
  buildNotificationGuard,
  openWhatsAppNotificationChatScript,
  notificationSettingsPatchScript,
  shouldAllowServiceNotification,
  serviceNotificationsOn,
  isUnreadReloadBlip,
  nextClearedUnread,
  CLOSE_OS_NOTIFICATIONS_SCRIPT,
} from "./notifications.js";
import {
  renameWhatsAppInstance,
  renameInstagramInstance,
  softDeleteService,
  restoreDeletedService,
  unreadFromWhatsAppTitle,
  unreadFromGmailTitle,
  unreadFromOutlookFolderTitle,
  googlePartitionForWorkspace,
  googlePartitionForProfile,
  listGoogleProfilesForWorkspace,
  reassignServiceGoogleProfile,
  renameGoogleProfile,
  usesSharedGoogleSession,
  listMicrosoftProfilesForWorkspace,
  reassignServiceMicrosoftProfile,
  renameMicrosoftProfile,
  usesSharedMicrosoftSession,
  usesStandaloneLogin,
  isGoogleAuthDomain,
  GOOGLE_AUTH_ORIGINS,
  ownsSession,
} from "@adr/service-adapters";
import {
  createWorkspace,
  listActiveWorkspaces,
  orderedServicesForWorkspace,
  railOrderForWorkspace,
  reorderWorkspaceRail,
  renameWorkspace,
  reorderWorkspaces,
  setActiveWorkspace,
} from "@adr/workspaces";
import { randomUUID } from "node:crypto";
import {
  oauthStart,
  isGoogleAccountsUrl,
  isGoogleLoginRejectionUrl,
  isServiceOwnSite as isOwnSite,
} from "./chrome-session.js";
import { createGoogleAuthBridge } from "./google-auth-window.js";
import { BrowserHistoryStore, isRecordableUrl } from "./browser-history.js";
import {
  ClosedTabStack,
  completeWithWww,
  FIND_SEED_MAX_CHARS,
  FIND_SELECTION_WORLD_ID,
  findSeedFromSelection,
  nextZoomLevel,
  pageOwnsFindAndPrint,
  pickFavicon,
  pickSpellCheckerLanguages,
} from "./browser-features.js";
import {
  type BrowserTabInfo,
  cycleTab,
  mergeTabOrderIntoRail,
  collapseBrowserServices,
  collapseRailBrowserTabs,
  expandRailBrowserTabs,
  moveTabAfter,
  purgeClosedBrowserTabs,
  tabAfterClose,
  tabsToTheRight,
  tabTitle,
} from "./browser-tabs.js";
import { configureSessionUserAgent, whatsappUserAgent } from "./whatsapp-user-agent.js";
import { DownloadManager } from "./downloads.js";
import { stateDiff } from "./state-diff.js";
import { createPermissionHandler, originOf } from "./permission-handler.js";
import { isMeetCallUrl, isMeetUrl, meetRoom, teamsInCall } from "./meet.js";
import { createMeetIntegration } from "./meet-integration.js";
import { calendarEventTemplateUrl, meetingFromChat } from "./schedule-meeting.js";
import { BACKUP_NOTICE_DELAY_MS, registerProfileIpc, showPendingBackupNotice } from "./profile-ipc.js";
import { createScreenShare } from "./screen-share.js";
import { createOptimizerController } from "./optimizer/index.js";
import { openInPreferredBrowser } from "./external-browser.js";
import { permissionGrantKey } from "./permission-policy.js";
import { safeLogLine } from "./redact.js";
import { buildDiagnosticSnapshot, writeDiagnosticExport } from "./diagnostics.js";
import { isAllowedExternalUrl, isShellPageUrl } from "./url-allowlist.js";
import { CRM_WORLD_ID, isCrmPagePath, SAVE_CONTACT_BUTTON } from "./whatsapp-inject.js";
import {
  isChromeWebStoreUrl,
  isSameOriginAs,
  isTeamsMeetingUrl,
  outlookHomeFor,
  teamsMeetingTarget,
  serviceDriftedOffSite,
  isWhatsAppAppUrl,
  shouldOpenServiceUrlExternally,
  servicePopupDisposition,
  unwrapRedirectUrl,
  browserRestoreUrl,
  browserHistorySnapshot,
  resolveNavInput,
} from "./service-navigation.js";
import { calculateWorkspaceLayout } from "./workspace-layout.js";
import { AdBlockManager, hostnameFromUrl } from "./ad-blocker.js";
import { attachContextMenu } from "./context-menu.js";
import { shouldPersistSpotifyCookie } from "./spotify-cookie.js";
import { assertSafePartitionName } from "@adr/partitions";
import { buildPasswordFillScript, type PasswordFillResult } from "./password-fill.js";
import { PasswordVault, readPasswordCsvFile } from "./password-vault.js";
import { bitwardenItemsToEntries } from "./password-vault-format.js";
import {
  BitwardenError,
  bitwardenStatus,
  createBwRunner,
  findBitwardenCli,
  pullBitwardenItems,
} from "./bitwarden-cli.js";
import { DesktopUpdater, type DesktopUpdateState } from "./desktop-updater.js";
import { canInstallUpdateNow } from "./update-policy.js";
import { newContactUrl, toE164 } from "./google-contacts.js";
import {
  PinAttemptThrottle,
  WhatsAppLock,
  resolveWhatsAppLocked,
  resolveWhatsAppLockStorageScope,
  resolveWhatsAppLockTimeoutMinutes,
  whatsappLockExpired,
  latestWhatsAppActivity,
} from "./whatsapp-lock.js";
import { LOCK_STORAGE_UNAVAILABLE, WhatsAppLockManager } from "./whatsapp-lock-manager.js";
import {
  buildLushaCardScript,
  LUSHA_WORLD_ID,
  normalizeLinkedInProfileUrl,
  parseLushaContact,
} from "./lusha.js";
import { createTaskbarBadgePng, describeTaskbarBadge } from "./taskbar-badge.js";

const WHATSAPP_URL = "https://web.whatsapp.com/";
const CRM_URL = "https://app.adragencia.com.br/";
/** O CRM não é ServiceInstance: esta é a chave dele em notifications.serviceEnabled. */
const CRM_SURFACE_ID = "crm";

/** A aba do CRM está no CRM, e não em algum lugar para onde um link a levou. */
function isCrmUrl(url: string): boolean {
  return isSameOriginAs(url, CRM_URL);
}
const SHELL_RAIL_PX = 68;
const SHELL_EXPANDED_RAIL_PX = 224;
const TITLEBAR_PX = 36;
const BROWSER_TOOLBAR_PX = 48;
/** Faixa de abas, dentro da mesma view da barra (ver browser-tabs.ts). */
const BROWSER_TABSTRIP_PX = 36;

/**
 * Derivado de `ServiceKind`, e não uma segunda lista escrita à mão.
 *
 * A lista paralela já tinha divergido: faltava "instagram", e o
 * `svc.kind as ViewKind` lá embaixo silenciava o compilador. Como `viewMeta.kind`
 * é a origem do `serviceKind` que `decidePermission` recebe, um kind ausente
 * daqui não quebra o build — ele vira permissão negada em runtime, sem diálogo.
 */
export type ViewKind = ServiceKind | "crm" | "shell" | "panel";

type Surface = "crm" | "settings" | "notifications" | "empty" | `service:${string}`;

type FeedItem = {
  id: string;
  text: string;
  ts: number;
  read: boolean;
  url?: string;
  surface?: string;
};

/**
 * `switch` sem `default`, de propósito: assim o compilador cobra a linha de todo
 * `ServiceKind` novo. A cadeia de `if` que existia aqui caía num `return CRM_URL`
 * — um kind esquecido carregava o CRM DENTRO da partição do serviço, misturando
 * as duas sessões, e `ensureServiceLoaded` gravava isso como a home dele.
 */
function serviceUrl(kind: ServiceKind): string {
  switch (kind) {
    case "whatsapp":
      return WHATSAPP_URL;
    case "gmail":
      return "https://mail.google.com/mail/u/0/#inbox";
    case "calendar":
      return "https://calendar.google.com/calendar/u/0/r";
    case "drive":
      return "https://drive.google.com/drive/u/0/home";
    case "notion":
      return "https://www.notion.so/";
    case "trello":
      return "https://trello.com/";
    case "chatgpt":
      return "https://chatgpt.com/";
    case "claude":
      return "https://claude.ai/";
    case "gemini":
      return "https://gemini.google.com/app";
    case "meet":
      return "https://meet.google.com/";
    case "youtube":
      return "https://www.youtube.com/";
    case "browser":
      return "https://www.google.com/";
    case "spotify":
      return "https://open.spotify.com/";
    case "instagram":
      return "https://www.instagram.com/";
    case "tiktok":
      return "https://www.tiktok.com/";
    case "outlook":
      return "https://outlook.office.com/mail/";
    case "teams":
      return "https://teams.microsoft.com/";
  }
}

/**
 * Atalhos de navegador (Ctrl+F/P/D/L, F3, F6…) sem perguntar à página: ADR
 * Browser e Instagram, e qualquer serviço fora do site dele. Nos demais a
 * página tem os dela — no Notion Ctrl+P é a busca, Ctrl+D duplica o bloco e
 * Ctrl+L copia o link — e a barra visível não pode roubá-los.
 */
function hasBrowserChrome(kind: ServiceKind): boolean {
  return kind === "browser" || kind === "instagram";
}

/**
 * Barra de endereço visível: em todo serviço, para dar para copiar (e colar)
 * o link da página aberta — e-mail, vídeo, quadro, conversa do ChatGPT. Menos
 * o WhatsApp: o endereço dele é sempre o mesmo e a barra só tiraria espaço.
 */
function showsAddressBar(kind: ServiceKind): boolean {
  return kind !== "whatsapp";
}

/**
 * Faixa de abas só no ADR Browser: as abas são os serviços "browser" do
 * workspace. Instagram e Google fora do site têm barra, mas não são abas.
 */
function hasTabStrip(kind: ServiceKind): boolean {
  return kind === "browser";
}

function defaultNotifications(): NotificationSettings {
  return {
    enabled: true,
    respectWhatsAppMute: true,
    serviceEnabled: { crm: false },
    trayBadge: true,
    quietHours: false,
    quietFromHour: 19,
    quietToHour: 8,
  };
}

export function createWorkspaceWindow(opts: {
  dirname: string;
  viewMeta: WeakMap<WebContents, { kind: ViewKind; workspaceId: string; serviceId?: string }>;
  /** `path` opcional: caminho DENTRO do CRM para onde a aba deve ir ao aparecer. */
  setShowCrmSurface: (fn: (path?: string, workspaceId?: string) => void) => void;
  setSaveGoogleContact: (
    fn: (payload: {
      name?: unknown;
      phone?: unknown;
    }) => Promise<{ opened: true; name: string | null }>,
  ) => void;
  setScheduleMeeting: (
    fn: (payload: { name?: unknown; phone?: unknown }) => Promise<{ opened: true }>,
  ) => void;
  getCrmPanelKillSwitch: () => { enabled: boolean; reason?: string };
  setCrmPanelKillSwitch: (next: { enabled: boolean; reason?: string }) => void;
  setFlushSessions: (fn: () => Promise<void>) => void;
  invalidateCrmSession: (workspaceId: string) => void;
  /** Chamada autenticada ao CRM (cookies da sessão pessoal, invalida cache em 401/403). */
  callCrmJson: (workspaceId: string, apiPath: string, init?: RequestInit) => Promise<unknown>;
}): void {
  const statePath = path.join(app.getPath("userData"), "state.v1.json");
  const passwordVault = new PasswordVault(
    path.join(app.getPath("userData"), "vault", "password-vault.v1.json"),
    safeStorage,
  );
  /** Histórico e abas abertas do ADR Browser (ver browser-history.ts). */
  const browserHistory = new BrowserHistoryStore(
    path.join(app.getPath("userData"), "history", "browser-history.v1.json"),
    safeStorage,
  );
  // Fechamento em curso: tratadores de crash não recriam abas a partir daqui.
  let appQuitting = false;
  app.on("before-quit", () => {
    appQuitting = true;
  });
  const pinThrottle = new PinAttemptThrottle(
    5,
    30_000,
    path.join(app.getPath("userData"), "vault", "whatsapp-pin-attempts.v1.json"),
  );
  // PIN criado, trocado ou apagado: os erros contra o PIN antigo não contam mais.
  const resetPinAttempts = (throttleKey: string): void => pinThrottle.reset(throttleKey);
  const whatsappLock = new WhatsAppLock(
    path.join(app.getPath("userData"), "vault", "whatsapp-lock.v1.json"),
    safeStorage,
    resetPinAttempts,
  );
  const whatsappLockSpecific = (serviceId: string): WhatsAppLock =>
    new WhatsAppLock(
      path.join(app.getPath("userData"), "vault", `whatsapp-lock.${serviceId}.v1.json`),
      safeStorage,
      resetPinAttempts,
    );
  const whatsappLockFor = (serviceId?: string): WhatsAppLock => {
    if (serviceId) {
      const specific = whatsappLockSpecific(serviceId);
      // Configuração explícita por conta nunca pode cair no PIN global legado:
      // arquivo ausente/corrompido deve abrir a recuperação daquela conta.
      if (
        resolveWhatsAppLockStorageScope(serviceId, appState.settings, specific.hasPin()) ===
        "service"
      ) {
        return specific;
      }
    }
    return whatsappLock;
  };
  const isWhatsAppLocked = (serviceId: string): boolean =>
    resolveWhatsAppLocked(serviceId, appState.settings);
  const loaded = loadAppState(statePath);
  if (!loaded.ok && loaded.locked) {
    // Arquivo bom, só preso por outro processo: recomeçar do zero aqui gravaria
    // um estado vazio por cima dele (= deslogado de tudo). Melhor não abrir.
    dialog.showErrorBox(
      "ADR Workspace",
      "O arquivo de configuração está em uso por outro programa (antivírus ou instalação em andamento) ou sem permissão de acesso. Aguarde alguns segundos e abra o ADR Workspace de novo; se continuar, verifique as permissões da pasta de dados do ADR Workspace (%APPDATA%).",
    );
    app.exit(1);
    return;
  }
  /** Cópias do estado ilegível; avisadas ao usuário quando a janela estiver de pé. */
  let quarantinedStateCopies: string[] = [];
  // Principal existe mas foi rejeitado e o `.bak` abriu (ex.: voltar a uma
  // versão anterior do app): o save abaixo grava o backup, mais velho, por cima
  // do principal mais novo. Também precisa da cópia.
  const restoredFromBackup = loaded.ok && loaded.source === "backup" && fs.existsSync(statePath);
  if (!loaded.ok || restoredFromBackup) {
    // O save logo abaixo recomeça do zero; guarda o que havia antes que o
    // segundo save promova o estado vazio a `.bak`.
    try {
      quarantinedStateCopies = quarantineAppStateFiles(statePath);
    } catch (error) {
      // Seguir em frente apagaria a configuração; mesmo critério do backup de boot.
      console.error("não foi possível preservar o estado ilegível", error);
      dialog.showErrorBox(
        "ADR Workspace",
        "O arquivo de configuração não pôde ser lido nem copiado. O aplicativo será fechado para não sobrescrevê-lo. Verifique o espaço livre e as permissões da pasta de dados.",
      );
      app.exit(1);
      return;
    }
  }
  // Aba do ADR Browser fechada só volta pelo Ctrl+Shift+T, que é só em memória:
  // depois de reiniciar ela não volta mais, e sem esta limpeza cada aba já
  // aberta e fechada ficava para sempre no state (ver purgeClosedBrowserTabs).
  let appState: AppStateV1 = purgeClosedBrowserTabs(
    ensureDefaultWorkspaceState(loaded.ok ? loaded.state : createEmptyAppState()),
  );
  const lockTimeoutMinutes = (serviceId: string): number =>
    resolveWhatsAppLockTimeoutMinutes(serviceId, appState.settings);
  const lockTimeoutMs = (serviceId: string): number => {
    const min = lockTimeoutMinutes(serviceId);
    return min > 0 ? min * 60 * 1000 : 0;
  };
  const whatsappUnlocked = new Set<string>();
  const whatsappLastActive = new Map<string, number>();
  let whatsappUnlockPromptOpen = false;
  const pinLockoutMessage = (ms: number): string =>
    ms > 90_000
      ? `Muitas tentativas. Tente novamente em ${Math.ceil(ms / 60_000)} min`
      : `Muitas tentativas. Tente novamente em ${Math.ceil(ms / 1000)}s`;
  /** Único caminho para conferir um PIN: desbloquear, desativar e trocar contam juntos. */
  const verifyWhatsAppPin = (lock: WhatsAppLock, pin: string): { ok: boolean; message: string } => {
    const result = pinThrottle.verify(lock.throttleKey, () => lock.verify(pin));
    if (result.ok) return { ok: true, message: "" };
    return {
      ok: false,
      message: result.reason === "locked" ? pinLockoutMessage(result.retryInMs) : "PIN incorreto",
    };
  };
  if (!appState.settings.notifications) {
    appState = parseAppState({
      ...appState,
      settings: { ...appState.settings, notifications: defaultNotifications() },
    });
  }
  saveAppStateAtomic(statePath, appState);

  // Regras de estado/cofre do PIN (migração do legado, ativar, desativar): ver
  // whatsapp-lock-manager.ts, testado sem Electron. Aqui ficam prompts e UI.
  const lockManager = new WhatsAppLockManager({
    getState: () => appState,
    commit: (next) => {
      appState = next;
      saveAppStateAtomic(statePath, appState);
      // PIN ligado/desligado muda o que o toast mostra (hidePreview). Adiado: a
      // migração abaixo chama commit antes de as views existirem.
      setImmediate(() => void patchAllNotificationSettings().catch(() => undefined));
    },
    legacyLock: whatsappLock,
    sessionLock: whatsappLockSpecific,
  });
  try {
    // Bloqueio global legado → um cofre por sessão, uma vez. Com o chaveiro
    // travado não roda; cada ação de PIN tenta de novo (lockManager.target).
    lockManager.migrateLegacy();
  } catch (error) {
    // Disco cheio etc.: o legado segue valendo e cada ação de PIN tenta de novo.
    console.error("migração do bloqueio do WhatsApp falhou", error);
  }

  const applyNativeTheme = (theme: "light" | "dark" | "system"): void => {
    nativeTheme.themeSource = theme;
  };
  applyNativeTheme(appState.settings.theme);

  let workspaceId = appState.activeWorkspaceId || appState.workspaces[0]!.id;

  /**
   * A Lusha é chamada pelo backend do CRM, que mantém a chave criptografada.
   * O Desktop encaminha somente a sessão pessoal e recebe o resultado já
   * sanitizado; nenhuma credencial Lusha fica no instalador ou no navegador.
   *
   * `targetWorkspaceId` é obrigatório: um default para o workspace ATUAL fazia
   * etapas de um mesmo fluxo caírem em CRMs diferentes se o usuário trocasse
   * de workspace no meio.
   */
  async function callCrmLusha(
    input: Record<string, unknown>,
    targetWorkspaceId: string,
  ): Promise<Record<string, unknown>> {
    const data = await opts.callCrmJson(targetWorkspaceId, "/api/crm/lusha/contact", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(input),
      // O CRM ainda chama a API da Lusha do lado dele: mais folga que o padrão.
      signal: AbortSignal.timeout(60_000),
    });
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  }
  const display = screen.getPrimaryDisplay();
  const work = display.workArea;
  // Empacotado a extensão vai em resources/vendor (extraResources); em dev fica na raiz do monorepo.
  const vendorRoot = app.isPackaged
    ? path.join(process.resourcesPath, "vendor")
    : path.resolve(opts.dirname, "../../../../vendor");
  // Extensão ausente não pode derrubar a janela — desliga só o painel do CRM.
  let extensionScript = "";
  let vendorDir = vendorRoot;
  try {
    vendorDir = resolveVendorExtensionDir(vendorRoot);
    extensionScript = buildExtensionInjection(vendorDir, CRM_URL);
  } catch (error) {
    opts.setCrmPanelKillSwitch(
      applyCrmPanelKillSwitch(opts.getCrmPanelKillSwitch(), false, "vendor-missing"),
    );
    console.error("extensão CRM indisponível", vendorDir, error);
  }
  const loggedSessions = new WeakSet<Electron.Session>();
  const loggedSpotifyCookies = new WeakSet<Electron.Session>();

  const iconPath = path.join(
    opts.dirname,
    "../shell",
    process.platform === "win32" ? "taskbar-icon.png" : "adr-logo.png",
  );
  const appIcon = nativeImage.createFromPath(iconPath);
  // Este é o tamanho de RESTAURADO, não o de abertura: o app abre maximizado
  // (`win.maximize()` no final). Nascer com o workArea inteiro fazia o botão do
  // meio devolver uma janela do tamanho exato da maximizada — clicar em
  // restaurar não mudava nada na tela.
  const restoredWidth = Math.round(work.width * 0.72);
  const restoredHeight = Math.round(work.height * 0.82);
  const windowOptions: Electron.BaseWindowConstructorOptions = {
    x: work.x + Math.round((work.width - restoredWidth) / 2),
    y: work.y + Math.round((work.height - restoredHeight) / 2),
    width: restoredWidth,
    height: restoredHeight,
    title: "ADR Workspace",
    // Cor de antes da primeira pintura: fixa no escuro, o tema claro piscava.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0D1526" : "#F4F6F8",
    show: false,
    frame: false,
    // Abaixo disso a barra do Browser e a lateral se sobrepunham à página.
    minWidth: 640,
    minHeight: 480,
  };
  if (!appIcon.isEmpty()) windowOptions.icon = appIcon;

  const win = new BaseWindow(windowOptions);
  // Fechar a janela destrói todas as views antes do before-quit: quem trata
  // "view destruída" precisa saber que é o fechamento, não a aba morrendo.
  let windowClosing = false;
  win.on("close", () => {
    windowClosing = true;
  });
  if (!appIcon.isEmpty()) win.setIcon(appIcon);

  const HIDDEN = { x: 0, y: 0, width: 0, height: 0 } as const;

  /**
   * Esconder só com bounds 0x0 deixava a view VISÍVEL para o Chromium. Três
   * consequências, todas caras: ele não aplicava o descarte de memória de aba
   * oculta, seguia compondo a superfície, e o `setBackgroundThrottling(true)`
   * espalhado por este arquivo não fazia efeito nenhum — throttling só vale
   * para WebContents que o Chromium considera não visível. `setVisible` junto
   * do bounds resolve os três de uma vez.
   */
  const place = (view: WebContentsView, bounds: Electron.Rectangle): void => {
    view.setBounds(bounds);
    view.setVisible(bounds.width > 0 && bounds.height > 0);
  };

  /** Views que o próprio app fechou: o "destroyed" delas é esperado. */
  const closingViews = new WeakSet<WebContentsView>();
  function closeView(view: WebContentsView): void {
    closingViews.add(view);
    view.webContents.close();
  }

  const shellView = new WebContentsView({
    webPreferences: {
      preload: path.join(opts.dirname, "../shell/shell-preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  // Mesma cor do body do shell (--bg), que hoje cobre a janela inteira.
  const themeBackground = (): string => (nativeTheme.shouldUseDarkColors ? "#0D1526" : "#F4F6F8");
  shellView.setBackgroundColor(themeBackground());
  opts.viewMeta.set(shellView.webContents, { kind: "shell", workspaceId });
  shellView.webContents.loadFile(path.join(opts.dirname, "../shell/index.html"));


  /**
   * Barra da mini-janela do Meet ("Abrir" e "✕"), criada só na primeira reunião
   * com mini-janela. Antes, esconder a mini-janela só existia no botão direito do
   * ícone do Meet, e voltar para a reunião só pela barra lateral.
   */
  let miniBar: WebContentsView | null = null;
  /** Serviço do Meet que está na mini-janela agora ("" = nenhum). */
  let miniServiceId = "";
  const MINI_BAR_PX = 28;
  const ensureMiniBar = (): WebContentsView => {
    if (miniBar && !miniBar.webContents.isDestroyed()) return miniBar;
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(opts.dirname, "../shell/mini-bar-preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    view.setBackgroundColor("#0b141b");
    opts.viewMeta.set(view.webContents, { kind: "shell", workspaceId });
    // Mesma trava das outras telas do shell: link ou arquivo solto na barra não
    // a leva para fora (conteúdo remoto com cara de parte do app).
    view.webContents.on("will-navigate", (event) => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    void view.webContents.loadFile(path.join(opts.dirname, "../shell/mini-bar.html"));
    miniBar = view;
    return view;
  };

  // Overlay transparente: command palette, slide-over de notificações e toast.
  // Fica 0x0 quando nada está visível para não roubar cliques dos serviços.
  const overlay = new WebContentsView({
    webPreferences: {
      preload: path.join(opts.dirname, "../shell/shell-preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      transparent: true,
    },
  });
  overlay.setBackgroundColor("#00000000");
  opts.viewMeta.set(overlay.webContents, { kind: "shell", workspaceId });
  overlay.webContents.loadFile(path.join(opts.dirname, "../shell/overlay.html"));

  const panel = new WebContentsView({
    webPreferences: {
      preload: path.join(opts.dirname, "../shell/shell-preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  panel.setBackgroundColor(themeBackground());
  opts.viewMeta.set(panel.webContents, { kind: "panel", workspaceId });
  // Configurações carregam na primeira abertura: antes eram um renderer residente
  // desde o boot, recebendo cada broadcast escondido. Ao carregar, a página pede
  // o estado (com a aba do painel); só a sub-aba pedida antes disso espera aqui.
  let panelLoaded = false;
  let pendingPanelTab: string | undefined;
  panel.webContents.on("did-finish-load", () => {
    if (pendingPanelTab) panel.webContents.send("shell:panel-tab", pendingPanelTab);
    pendingPanelTab = undefined;
  });
  const ensurePanel = (): void => {
    if (panelLoaded) return;
    panelLoaded = true;
    void panel.webContents.loadFile(path.join(opts.dirname, "../shell/panel.html")).catch(() => {
      panelLoaded = false;
    });
  };
  // Lateral, barra de título e overlay sem render-process-gone ficavam mortas: a
  // janela sem moldura perdia os botões de janela e a navegação. Recarrega.
  for (const [view, file] of [
    [shellView, "index.html"],
    [overlay, "overlay.html"],
    [panel, "panel.html"],
  ] as const) {
    view.webContents.on("render-process-gone", (_event, details) => {
      if (details.reason === "clean-exit" || win.isDestroyed()) return;
      pushLog("error", "shell render-process-gone", { file, reason: details.reason });
      if (view === panel) {
        panelLoaded = false;
        if (activeSurface === "settings" || activeSurface === "notifications" || activeSurface === "empty") {
          ensurePanel();
        }
        return;
      }
      void view.webContents.loadFile(path.join(opts.dirname, "../shell", file)).catch(() => undefined);
    });
  }

  let browserToolbar: WebContentsView | null = null;
  /**
   * O fundo nativo é o que aparece enquanto uma página recarrega ou redimensiona.
   * Definido só na criação, ele ficava no tema antigo depois de trocar o tema (ou
   * de o Windows trocar, no tema "sistema"): no claro, piscava escuro.
   */
  const syncThemeBackgrounds = (): void => {
    if (win.isDestroyed()) return;
    win.setBackgroundColor(themeBackground());
    shellView.setBackgroundColor(themeBackground());
    panel.setBackgroundColor(themeBackground());
    browserToolbar?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#0a0f1e" : "#ffffff");
  };
  nativeTheme.on("updated", syncThemeBackgrounds);
  win.on("closed", () => nativeTheme.off("updated", syncThemeBackgrounds));
  let browserToolbarLoaded = false;
  const ensureBrowserToolbar = (): WebContentsView => {
    if (browserToolbar?.webContents && !browserToolbar.webContents.isDestroyed()) return browserToolbar;
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(opts.dirname, "../shell/browser-preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    browserToolbar = view;
    browserToolbarLoaded = true;
    view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#0a0f1e" : "#ffffff");
    opts.viewMeta.set(view.webContents, { kind: "shell", workspaceId });
    view.webContents.on("will-navigate", (event) => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("did-finish-load", () => {
      if (browserToolbar !== view) return;
      lastBrowserTabs = "";
      pushBrowserToolbarState();
    });
    view.webContents.on("render-process-gone", () => {
      if (browserToolbar !== view || win.isDestroyed()) return;
      releaseBrowserToolbar();
      if (!windowClosing) layout();
    });
    view.webContents.on("context-menu", (_event, params) => {
      if (!params.isEditable) return;
      const flags = params.editFlags;
      Menu.buildFromTemplate([
        { role: "cut", label: "Recortar", enabled: flags.canCut },
        { role: "copy", label: "Copiar", enabled: flags.canCopy },
        { role: "paste", label: "Colar", enabled: flags.canPaste },
        { type: "separator" },
        { role: "selectAll", label: "Selecionar tudo", enabled: flags.canSelectAll },
      ]).popup({ window: win });
    });
    attachKeys(view.webContents);
    win.contentView.addChildView(view);
    void view.webContents.loadFile(path.join(opts.dirname, "../shell/browser-toolbar.html")).catch(() => {
      if (browserToolbar === view) releaseBrowserToolbar();
    });
    return view;
  };

  function releaseBrowserToolbar(): void {
    const view = browserToolbar;
    browserToolbar = null;
    browserToolbarLoaded = false;
    lastBrowserTabs = "";
    if (!view) return;
    const contents = view.webContents;
    stopFind(false);
    if (!win.isDestroyed()) win.contentView.removeChildView(view);
    if (contents && !contents.isDestroyed()) {
      closingViews.add(view);
      contents.close();
    }
  }

  function releaseUnusedBrowserToolbar(): void {
    if (!browserToolbar) return;
    const needed = appState.services.some((service) => {
      const contents = serviceViews.get(service.id)?.webContents;
      return !service.deletedAt && contents && !contents.isDestroyed() && serviceNeedsChrome(service);
    });
    if (!needed) releaseBrowserToolbar();
  }

  /**
   * O prompt nasce a cada pedido e fecha ao responder: antes o renderer dele
   * ficava residente depois do primeiro PIN. Os ouvintes só agem na view atual —
   * a anterior fechando não pode cancelar um prompt encadeado (PIN → confirmar).
   */
  const newPromptOverlay = (): WebContentsView => {
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(opts.dirname, "../shell/prompt-preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    view.setBackgroundColor("#00000000");
    view.webContents.on("will-navigate", (event) => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    // O input.focus() da página só vale dentro dela: sem dar o foco à view, o PIN
    // digitado ia para a aba de baixo até a pessoa clicar no diálogo.
    view.webContents.on("did-finish-load", () => view.webContents.focus());
    // Se o diálogo não carregar, promptResolve fica pendurado e layout() volta a
    // esticar o promptOverlay (transparente) por cima de tudo — a janela inteira
    // fica sem receber cliques. Falhou, cancela.
    view.webContents.on("did-fail-load", (_e, code) => {
      if (code !== -3 && view === promptOverlay) cancelPrompt();
    });
    // Mesmo buraco pelo outro caminho, e este não deixa rastro: renderer morto não
    // emite did-fail-load.
    view.webContents.on("render-process-gone", () => {
      if (view === promptOverlay) cancelPrompt();
    });
    return view;
  };
  let promptOverlay = newPromptOverlay();

  // Telas do próprio app nunca navegam nem abrem janela. Sem isto, um link do
  // WhatsApp ou um .html do Explorer solto na barra lateral levava a view para
  // a página de fora — com o preload do shell e o IPC privilegiado junto.
  const shellDir = path.join(opts.dirname, "../shell");
  for (const view of [shellView, overlay, panel]) {
    view.webContents.on("will-navigate", (event) => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  }
  /** Quem chamou é o frame principal de uma página nossa (ver isShellPageUrl). */
  const fromShellPage = (event: Electron.IpcMainInvokeEvent): boolean => {
    const frame = event.senderFrame;
    return Boolean(frame && frame === event.sender.mainFrame && isShellPageUrl(frame.url, shellDir));
  };
  let promptResolve: ((value: string | null) => void) | null = null;
  let promptIsSecret = false;
  /**
   * Número do prompt aberto. A resposta tem de trazê-lo: prompts encadeados
   * (PIN → confirmar PIN) abrem o seguinte assim que o anterior resolve, e um
   * segundo Enter da página velha respondia o NOVO — a confirmação saía
   * preenchida com o primeiro PIN.
   */
  let promptId = 0;
  const hidePrompt = (): void => {
    place(promptOverlay, HIDDEN);
    // View destruída fica sem webContents (undefined), não só com isDestroyed().
    const contents = promptOverlay.webContents as WebContentsView["webContents"] | undefined;
    if (!contents || contents.isDestroyed() || !contents.getURL()) return;
    win.contentView.removeChildView(promptOverlay);
    closeView(promptOverlay);
  };
  const showPrompt = (
    title: string,
    initial: string,
    okLabel = "OK",
    secret = false,
    hint?: string,
    label?: string,
    allowEmpty = false,
    numeric = false,
  ): Promise<string | null> => {
    if (promptResolve) {
      promptResolve(null);
      promptResolve = null;
    }
    promptIsSecret = secret;
    promptId += 1;
    // close() é assíncrono: o prompt encadeado (confirmar PIN) chega com a view
    // anterior ainda fechando, e carregar nela deixava o diálogo invisível. Já
    // destruída, a view fica sem webContents e o acesso lançava, prendendo o
    // desbloqueio do WhatsApp até reiniciar o app.
    const current = promptOverlay.webContents as WebContentsView["webContents"] | undefined;
    if (closingViews.has(promptOverlay) || !current || current.isDestroyed()) {
      promptOverlay = newPromptOverlay();
    }
    const { width, height } = win.getContentBounds();
    // Abaixo da barra de título: com o diálogo aberto, ainda dá para arrastar e minimizar.
    place(promptOverlay, { x: 0, y: titlebarHeight(), width, height: Math.max(height - titlebarHeight(), 0) });
    const q = new URLSearchParams({
      title,
      initial,
      ok: okLabel,
      secret: secret ? "1" : "0",
      theme: appState.settings.theme,
      zoom: String(uiZoom()),
      id: String(promptId),
    });
    if (hint != null) q.set("hint", hint);
    if (label != null) q.set("label", label);
    if (allowEmpty) q.set("empty", "1");
    if (numeric) q.set("numeric", "1");
    void promptOverlay.webContents.loadFile(path.join(opts.dirname, "../shell/prompt.html"), {
      search: q.toString(),
    });
    win.contentView.addChildView(promptOverlay);
    return new Promise((resolve) => {
      promptResolve = resolve;
    });
  };
  /**
   * Prompt de PIN. O prompt secreto manda o valor cru (a senha do cofre pode ter
   * espaço de propósito); PIN é só dígito, então espaço colado junto sai aqui —
   * senão `1234 ` contava como tentativa errada e levava ao bloqueio.
   */
  const askPin = async (...args: Parameters<typeof showPrompt>): Promise<string | null> => {
    const [title, initial, okLabel, secret, hint, label, allowEmpty] = args;
    return (await showPrompt(title, initial, okLabel, secret, hint, label, allowEmpty, true))?.trim() || null;
  };
  const cancelPrompt = (): void => {
    if (!promptResolve) return;
    const resolve = promptResolve;
    promptResolve = null;
    promptIsSecret = false;
    hidePrompt();
    resolve(null);
    setTimeout(focusActiveSurface, 0);
  };
  hidePrompt();

  const crmViews = new Map<string, WebContentsView>();
  const crmRetryTimers = new Map<string, NodeJS.Timeout>();
  const crmCrashAt = new Map<string, number>();
  /** Views que já escutam os atalhos — ver attachKeys, declarado bem mais abaixo. */
  const keyed = new WeakSet<WebContents>();
  /** Workspaces cuja view do CRM existe mas ainda não navegou. Ver ensureCrmLoaded. */
  const crmNeedsLoad = new Set<string>();
  /** Sessões do CRM já vigiadas contra o 404 de RSC — o listener é por sessão. */
  const crmRscWatched = new WeakSet<Electron.Session>();
  /** 404s de RSC por workspace, contados dentro de uma janela curta (ver onCompleted). */
  const crmRsc404 = new Map<string, { count: number; since: number }>();
  /** Recargas automáticas seguidas depois de falha de load, por workspace. */
  const crmLoadRetries = new Map<string, number>();
  const crmAutoReloads = new Map<string, number>();

  /**
   * Diferente das abas de serviço, a do CRM não tratava did-fail-load nem
   * mostrava erro: uma carga que falhava (rede instável, certificado, DNS frio)
   * deixava a view no fundo escuro #0b141b para sempre — uma tela preta sem
   * explicação. Agora ela recarrega como as outras e, se a falha persistir,
   * mostra uma mensagem em vez de ficar calada.
   */
  const showCrmLoadError = (view: WebContentsView, detail: string): void => {
    const dark = nativeTheme.shouldUseDarkColors;
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>ADR CRM</title>
<style>
:root{color-scheme:${dark ? "dark" : "light"};--bg:${dark ? "#0d1526" : "#f4f6f8"};--card:${dark ? "#18263e" : "#ffffff"};--fg:${dark ? "#f8fafc" : "#26292c"};--muted:${dark ? "#9ca6af" : "#637282"};--line:${dark ? "rgba(255,255,255,.12)" : "rgba(15,23,42,.12)"}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--fg);font:14px/1.5 Ubuntu,Cantarell,Noto Sans,system-ui,sans-serif}
.card{width:min(460px,100%);padding:30px;border:1px solid var(--line);border-radius:16px;background:var(--card);box-shadow:0 24px 60px -35px #0008}
.mark{display:grid;place-items:center;width:42px;height:42px;margin-bottom:18px;border-radius:11px;background:#10b98122;color:#059669;font-size:22px;font-weight:800}
h1{margin:0 0 8px;font-size:20px;line-height:1.25}p{margin:0;color:var(--muted)}
button{margin-top:22px;padding:10px 16px;border-radius:9px;border:0;background:#10b981;color:#04120a;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer}button:hover{background:#059669}button:focus-visible{outline:2px solid #10b981;outline-offset:3px}
.detail{margin-top:16px;padding-top:14px;border-top:1px solid var(--line);font-size:11px;color:var(--muted);word-break:break-all}
</style></head><body><div class="card">
<div class="mark" aria-hidden="true">!</div><h1>Não foi possível carregar o CRM</h1>
<p>Verifique sua conexão e tente novamente.</p>
<button id="go">Tentar novamente</button>
<div class="detail">${detail.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] || c)}</div>
</div><script>document.getElementById('go').onclick=()=>{location.href=${JSON.stringify(CRM_URL)};};</script></body></html>`;
    void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  };

  /**
   * Mede a página do CRM por dentro, no momento em que a sonda é chamada.
   *
   * `filhos: 0` = o React nunca montou (o `crm console` diz por quê).
   * `filhos > 0` com `altura: 0` = montou num viewport sem tamanho.
   * `texto > 0` = a página desenhou, e a tela preta é de outra natureza.
   *
   * `quando` existe porque o sintoma é "para de funcionar DEPOIS de algum tempo":
   * medir só no `did-finish-load` responde sobre um instante em que a aba ainda
   * estava boa. Comparar a mesma medida no load e na hora em que o usuário está
   * olhando para a tela preta é o que separa "nasceu quebrada" de "quebrou
   * depois" — e, se `filhos` cair entre as duas, de quem desmontou a página.
   */
  const probeCrmDom = (wsId: string, quando: string): void => {
    const contents = crmViews.get(wsId)?.webContents;
    if (!contents || contents.isDestroyed()) return;
    void contents
      .executeJavaScript(
        `(() => {
          const b = document.body;
          if (!b) return { prontidao: document.readyState, filhos: -1 };
          return {
            prontidao: document.readyState,
            filhos: b.childElementCount,
            texto: (b.innerText || "").trim().length,
            altura: b.scrollHeight,
            janela: innerWidth + "x" + innerHeight,
            oculta: document.hidden,
            fundo: getComputedStyle(b).backgroundColor,
          };
        })()`,
        true,
      )
      .then((dom) => pushLog("info", "crm dom", { quando, ...(dom as object) }))
      // Rejeita quando o frame morreu no meio — e isso também é resposta.
      .catch((error) => pushLog("error", "crm dom falhou", { quando, erro: String(error) }));
  };

  /** Navega a view do CRM. Único caminho — quem navega por fora fura o adiamento. */
  const loadCrmUrl = (wsId: string, url = CRM_URL): void => {
    const view = crmViews.get(wsId);
    if (!view) return;
    crmNeedsLoad.delete(wsId);
    void view.webContents.loadURL(url).catch(() => undefined);
  };

  /**
   * Primeira navegação do CRM, adiada até a view ter tamanho de verdade.
   *
   * A view era criada e mandada para o CRM no MESMO instante, no topo de
   * `createWorkspaceWindow` — muito antes do primeiro `layout()`, portanto com
   * bounds zerado. O app abre num WhatsApp (ver o `showSurface` do final), então
   * o CRM carregava inteiro num viewport 0x0: um app React que mede a janela na
   * montagem guarda zero, desenha nada, e não tem por que remontar depois. O
   * resultado é a "tela preta" com `crashed:false, loading:false` e a URL certa —
   * a página carregou mesmo, só que para uma janela que não existia.
   *
   * As views de serviço nunca tiveram isso: `needsInitialLoad` já adia a primeira
   * navegação pelo mesmo motivo, e o comentário lá cita "blank Calendar". É o
   * mesmo bug, e o CRM era o único lugar que ainda faltava.
   */
  const ensureCrmLoaded = (wsId: string): void => {
    if (!crmNeedsLoad.has(wsId)) return;
    const bounds = crmViews.get(wsId)?.getBounds();
    if (!bounds || bounds.width < 200 || bounds.height < 200) return;
    loadCrmUrl(wsId);
  };

  const ensureCrmView = (wsId: string): WebContentsView => {
    const existing = crmViews.get(wsId);
    if (existing && existing.webContents && !existing.webContents.isDestroyed()) return existing;
    if (existing) crmViews.delete(wsId);
    const partitionName = crmLoginPartition(wsId);
    const view = new WebContentsView({
      webPreferences: {
        partition: partitionName,
        preload: path.join(opts.dirname, "../preload/form-activity-preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    attachZoom(view.webContents);
    const crmSession = session.fromPartition(partitionName);
    attachPermissionHandler(crmSession, partitionName, "crm", CRM_SURFACE_ID, () => CRM_URL);
    /**
     * Recuperação da aba morta — o "o CRM para de funcionar depois de algum tempo".
     *
     * Medido no console da própria página: TODA rota do CRM (`/whatsapp`, `/admin`,
     * `/financeiro/*`, `/propostas`, `/leads`…) responde 404 ao prefetch RSC do
     * App Router. E o 404 é da SESSÃO, não da rota: as mesmas URLs, pedidas sem
     * cookie, devolvem 200 (`X-Matched-Path: /whatsapp.rsc`). Descartado também o
     * Skew Protection da Vercel — `__vdpl` inexistente devolve 200 igual.
     *
     * Ou seja: o servidor do CRM passa a 404 as requisições RSC desta sessão em
     * algum momento, e o roteador do Next fica sem para onde navegar. A aba não
     * crasha e não recarrega sozinha; num navegador comum o usuário aperta F5 sem
     * pensar, mas aqui a aba fica aberta por dias.
     *
     * A CAUSA é do lado do CRM (ver o relatório). Isto aqui não a conserta — faz o
     * F5 que o usuário faria, para que a aba volte por um caminho que passa pelo
     * middleware e, se for sessão expirada, chegue no /login.
     */
    if (!crmRscWatched.has(crmSession)) {
      crmRscWatched.add(crmSession);
      crmSession.webRequest.onCompleted((details) => {
        if (details.statusCode !== 404 || !details.url.includes("_rsc=")) return;
        if (!isCrmUrl(details.url)) return;
        // Janela de 2 min: três 404 soltos ao longo de dias numa aba aberta não
        // são a falha que derruba a navegação, e recarregar perdia formulário.
        const now = Date.now();
        const previous = crmRsc404.get(wsId);
        const fresh = previous && now - previous.since < 120_000;
        const seen = (fresh ? previous.count : 0) + 1;
        crmRsc404.set(wsId, { count: seen, since: fresh ? previous.since : now });
        // 3, não 1: um 404 isolado é rota que sumiu num deploy, e recarregar por
        // causa dele tiraria o usuário da tela por nada. A falha que interessa
        // derruba a navegação inteira e vem às dezenas.
        if (seen < 3) return;
        const attempts = crmAutoReloads.get(wsId) || 0;
        // Teto por view: se recarregar não resolve, insistir vira laço de F5 e o
        // usuário perde o que estivesse fazendo a cada minuto. Duas e para.
        if (attempts >= 2) return;
        crmRsc404.delete(wsId);
        crmAutoReloads.set(wsId, attempts + 1);
        pushLog("error", "crm rsc 404 — recarregando", {
          workspace: wsId,
          tentativa: attempts + 1,
          url: details.url.slice(0, 120),
        });
        const current = crmViews.get(wsId);
        // reloadIgnoringCache: se for build velho, o cache é justamente o problema.
        if (current && isCrmUrl(current.webContents.getURL())) {
          current.webContents.reloadIgnoringCache();
        } else loadCrmUrl(wsId);
      });
    }
    view.setBackgroundColor("#0b141b");
    view.webContents.setAudioMuted(appState.settings.crmAudioMuted);
    // Lambda, não a referência direta: `ensureCrmView` é chamada MUITO antes de
    // `openExternalServiceUrl` ser declarado (linha ~1156), e passar o const como
    // argumento o avalia na hora — zona morta temporal, ReferenceError, e a
    // criação da janela morre no meio. Sintoma: app com processos vivos e nenhuma
    // janela. Dentro da lambda a leitura só acontece no clique, quando já existe.
    attachContextMenu(view.webContents, (url) => openExternalServiceUrl(url));
    opts.viewMeta.set(view.webContents, { kind: "crm", workspaceId: wsId });
    // Link sem `target` (o "site" de um lead) também tirava a aba do CRM, e ela
    // não tem barra de endereço: ficava numa página de fora com cara de CRM.
    // Login do Google segue na aba (consentimento OAuth volta para o CRM).
    view.webContents.on("will-navigate", (event, url) => {
      if (isCrmUrl(url) || isGoogleAccountsUrl(url)) return;
      event.preventDefault();
      if (isAllowedExternalUrl(url)) openExternalServiceUrl(url, view.webContents);
    });
    // O will-navigate libera o login do Google, mas o servidor pode redirecionar
    // dali para qualquer site (OAuth com redirect_uri de terceiro): a página de
    // fora carregava dentro da aba do CRM. O que termina fora volta ao CRM.
    view.webContents.on("did-navigate", (_event, url) => {
      if (isCrmUrl(url) || !/^https?:/i.test(url)) return;
      try {
        if (/(^|\.)(google\.com|youtube\.com)$/i.test(new URL(url).hostname)) return;
      } catch {
        return;
      }
      pushLog("info", "crm navegou para fora", { url: url.slice(0, 120) });
      if (isAllowedExternalUrl(url)) void openInPreferredBrowser(url, preferredBrowser());
      loadCrmUrl(wsId);
    });
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (!url || url === "about:blank") return { action: "deny" };
      // Antes QUALQUER window.open navegava a própria aba do CRM para fora — o
      // site de um cliente, um PDF, um wa.me — e não havia volta: o botão de
      // recarregar recarrega a página em que a view está, não o CRM. Fora do
      // domínio do CRM vai para o navegador externo, como já acontece nos
      // serviços (ver attachInAppNavigation).
      if (!isCrmUrl(url)) {
        if (isAllowedExternalUrl(url)) openExternalServiceUrl(url, view.webContents);
        return { action: "deny" };
      }
      void view.webContents.loadURL(url).catch((error) => {
        pushLog("error", "crm popup falhou", { url: url.slice(0, 120), erro: String(error) });
      });
      return { action: "deny" };
    });
    /**
     * A chave "Notificações" do CRM não silenciava nada. Ela existe em
     * notifications.serviceEnabled["crm"] e o setPermissionRequestHandler a
     * consulta — mas esse handler só roda quando a página PEDE a permissão. O
     * CRM já pediu e já recebeu faz tempo; daí em diante ele chama
     * `new Notification(...)` direto e o Chromium não pergunta mais nada. O
     * mecanismo que de fato segura é o guard injetado, que troca
     * window.Notification — e a view do CRM era a única que não o recebia.
     */
    /**
     * A "tela preta" não deixa rastro no processo main: nada crasha, nada falha o
     * load, e `crm surface` já diz que a URL está certa e o load terminou. O que
     * sobra por explicar está DENTRO da página, e são duas coisas diferentes —
     * um erro de JS que aborta a montagem, ou um DOM montado que não pinta. As
     * duas sondas abaixo separam uma da outra sem depender de devtools aberto.
     */
    view.webContents.on(
      "console-message",
      ({ level, message, lineNumber, sourceId }) => {
        if (level !== "warning" && level !== "error") return;
        pushLog("error", "crm console", {
          nivel: level,
          mensagem: message.slice(0, 300),
          fonte: `${sourceId}:${lineNumber}`,
        });
      },
    );
    view.webContents.on("did-finish-load", () => {
      // O cartão de erro também "termina de carregar"; só o CRM zera as tentativas.
      if (isCrmUrl(view.webContents.getURL())) crmLoadRetries.delete(wsId);
      void injectNotificationGuard(view, CRM_SURFACE_ID).catch(() => undefined);
      // A medida de referência: como a página estava quando acabou de carregar.
      probeCrmDom(wsId, "load");
    });
    // Renderer que some sem crashar não emite `render-process-gone`, e a view fica
    // exibindo o último quadro — ou nada. `destroyed` é o único aviso que sobra.
    view.webContents.on("destroyed", () => {
      if (crmViews.get(wsId) !== view) return; // hibernação/troca de workspace: esperado
      if (appQuitting || windowClosing || win.isDestroyed()) {
        // Fechar o app destrói todas as views: não é a aba morrendo sozinha.
        crmViews.delete(wsId);
        return;
      }
      pushLog("error", "crm webContents destruido sem crash", { workspace: wsId });
      // Fora do mapa: o layout() seguinte leria getURL() de um webContents morto
      // (exceção a cada resize) e o CRM ficaria preto até reiniciar o app.
      crmViews.delete(wsId);
      if (win.isDestroyed()) return;
      try {
        win.contentView.removeChildView(view);
      } catch {
        // janela já fechando
      }
      if (activeSurface === "crm" && workspaceId === wsId) {
        setImmediate(() => {
          if (!win.isDestroyed()) layout();
        });
      }
    });
    view.webContents.on("did-fail-load", (_e, code, desc, url, isMain) => {
      if (!isMain || code === -3) return; // -3 = ERR_ABORTED, e.g. our own reload
      console.error("crm did-fail-load", wsId, code, desc, url);
      showCrmLoadError(view, `${desc || "erro"} (${code}) — ${url}`);
      const prevTimer = crmRetryTimers.get(wsId);
      if (prevTimer) clearTimeout(prevTimer);
      // Três tentativas, como nos serviços. Offline, recarregar a cada 4 s para
      // sempre fazia toda aba do CRM (até a oculta) piscar entre o cartão e o
      // load; daí em diante fica o cartão com "Tentar novamente".
      const retries = (crmLoadRetries.get(wsId) || 0) + 1;
      crmLoadRetries.set(wsId, retries);
      if (retries > 3) return;
      crmRetryTimers.set(
        wsId,
        setTimeout(() => {
          crmRetryTimers.delete(wsId);
          if (crmViews.get(wsId) === view) loadCrmUrl(wsId);
        }, 4000),
      );
    });
    /**
     * A view do CRM não tratava crash de renderer — as views de serviço tratam,
     * via CrashRecoveryRegistry. Renderer morto não some nem avisa: sobra o
     * retângulo com a cor de fundo da view, que é a "tela preta". E recarregar
     * não trazia de volta porque não havia processo para recarregar. Aqui ela
     * volta sozinha, e o motivo (`oom`, `crashed`…) fica no diagnóstico.
     */
    view.webContents.on("render-process-gone", (_e, details) => {
      pushLog("error", "crm render-process-gone", {
        workspace: wsId,
        reason: details.reason,
        exitCode: details.exitCode,
      });
      if (crmViews.get(wsId) !== view) return;
      const now = Date.now();
      const previous = crmCrashAt.get(wsId) || 0;
      crmCrashAt.set(wsId, now);
      // Crash em sequência (OOM repete) viraria laço quente de renderer
      // morrendo e renascendo. Na recaída, mostra o cartão com "Tentar
      // novamente" e deixa a decisão com o usuário.
      if (now - previous < 30_000) {
        showCrmLoadError(view, `o CRM fechou sozinho (${details.reason})`);
        return;
      }
      // Recria em vez de reload(): recarregar um renderer que já morreu nem
      // sempre pega, e quando não pega o sintoma é a MESMA tela preta — agora
      // sem nem o crash seguinte para avisar. View nova garante renderer novo.
      crmViews.delete(wsId);
      try {
        win.contentView.removeChildView(view);
        closeView(view);
      } catch {
        // já destruída pelo próprio crash
      }
      // Fora de foco não precisa recriar agora: ensureCrmView faz na volta.
      if (activeSurface === "crm" && workspaceId === wsId) layout();
    });
    win.contentView.addChildView(view);
    crmViews.set(wsId, view);
    // Aqui, e não só no laço lá de baixo: aquele roda uma vez e pega apenas as
    // views que existiam naquele instante. View do CRM recriada depois — pós
    // hibernação, pós crash, outro workspace — ficava sem atalho nenhum.
    attachKeys(view.webContents);
    // View nova, orçamento novo de recuperação: hibernação e troca de workspace
    // recriam a view, então o teto de duas tentativas não vira permanente.
    crmRsc404.delete(wsId);
    crmLoadRetries.delete(wsId);
    crmAutoReloads.delete(wsId);
    // Navega só quando a view tiver tamanho — ver ensureCrmLoaded.
    crmNeedsLoad.add(wsId);
    return view;
  };

  // Sem isto cada workspace visitado deixa uma view do CRM carregada para
  // sempre — N workspaces = N renderers vivos. Todo acesso passa por
  // ensureCrmView, que recria sob demanda, então fechar é seguro.
  /**
   * Fecha as conexões da sessão só quando nada mais a usa. Gmail, Agenda, Drive,
   * YouTube, Spotify e o ADR Browser dividem UMA sessão Google por workspace:
   * hibernar a Agenda derrubava o stream do Spotify tocando, um envio do Gmail
   * ou um download em andamento. Hasteada: closeCrmView é declarada antes dos
   * mapas de views serem usados.
   */
  function closeConnectionsIfUnused(ses: Electron.Session): void {
    const inUse = [...serviceViews.values(), ...crmViews.values()].some(
      (view) => !view.webContents.isDestroyed() && view.webContents.session === ses,
    );
    if (inUse || downloads.list().some((download) => download.state === "progressing")) return;
    void ses.closeAllConnections().catch(() => undefined);
  }

  const closeCrmView = (id: string): void => {
    const view = crmViews.get(id);
    if (!view) return;
    const timer = crmRetryTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      crmRetryTimers.delete(id);
    }
    const ses = view.webContents.session;
    win.contentView.removeChildView(view);
    closeView(view);
    crmViews.delete(id);
    crmNeedsLoad.delete(id);
    closeConnectionsIfUnused(ses);
  };

  const closeInactiveCrmViews = (keepId: string): void => {
    for (const id of [...crmViews.keys()]) {
      if (id === keepId) continue;
      // Trocar de workspace preserva o que está sendo editado, como a hibernação.
      void canHibernateCrm(id).then((safe) => {
        if (safe && id !== keepId) closeCrmView(id);
      }).catch((error) => pushLog("error", "crm hibernate check falhou", String(error)));
    }
  };

  const serviceViews = new Map<string, WebContentsView>();
  // URL de cada aba (hibernada inclusive). Para o disco só vai pelo
  // browserHistory, criptografado e sem página de login nem URL com token.
  const suspendedBrowserUrls = new Map<string, string>();
  // Ctrl+Shift+T. Em memória pelo mesmo motivo: a URL da aba fechada não vai
  // para o disco, e a partição dela só sobrevive enquanto o app não reinicia.
  const closedBrowserTabs = new ClosedTabStack();
  /** Zoom de página por host (ver sitePageZoom). */
  const siteZoomLevels = new Map<string, number>();
  // Ícone do site por aba (já filtrado por pickFavicon), para a barra mostrar
  // na troca de aba sem esperar a página anunciar de novo.
  const browserFavicons = new Map<string, string | null>();
  // Título da página por aba, para a faixa de abas: a aba hibernada continua
  // com o nome do site em vez de virar "ADR Browser".
  const browserTitles = new Map<string, string>();
  // Reabrir o app onde as abas estavam: cada aba volta no último endereço (a
  // primeira carga usa suspendedBrowserUrls, ver ensureServiceLoaded). Aba que
  // não existe mais sai do arquivo aqui.
  for (const [id, tab] of Object.entries(
    browserHistory.restoreTabs((id) =>
      appState.services.some((s) => s.id === id && s.kind === "browser" && !s.deletedAt),
    ),
  )) {
    suspendedBrowserUrls.set(id, tab.url);
    if (tab.title) browserTitles.set(id, tab.title);
  }
  /** Última faixa enviada (JSON), para não reenviar a cada broadcastState. */
  let lastBrowserTabs = "";
  /** WebContents onde a busca da barra (Ctrl+F) está ativa. */
  let findTargetId: number | null = null;
  /**
   * Última aba aberta no fundo a partir de `opener` (clique do meio/Ctrl):
   * a próxima entra depois dela. Trocar de aba recomeça, como no Chrome.
   */
  let linkTabChain: { opener: string; last: string } | null = null;
  /** Abas silenciadas: a view recriada (hibernação, crash) volta muda. */
  const mutedBrowserTabs = new Set<string>();
  /** Aba com vídeo (ou outro elemento) em tela cheia pela própria página. */
  let htmlFullscreenServiceId: string | null = null;
  // Só desfaz a tela cheia da janela quem a ligou: se o usuário já estava em
  // tela cheia (F11), sair do vídeo não pode tirá-lo dela.
  let windowFullscreenByPage = false;
  const spellcheckSessions = new WeakSet<Electron.Session>();
  const suspendedBrowserHistory = new Map<
    string,
    NonNullable<ReturnType<typeof browserHistorySnapshot>>
  >();

  function rememberBrowserNavigation(id: string, contents: WebContents): void {
    const svc = appState.services.find((s) => s.id === id);
    if (svc?.kind !== "browser") return;
    try {
      const url = contents.getURL();
      if (url) suspendedBrowserUrls.set(id, browserRestoreUrl(svc.startUrl, url));
      const history = contents.navigationHistory;
      const snapshot = browserHistorySnapshot(history.getAllEntries(), history.getActiveIndex());
      if (snapshot) suspendedBrowserHistory.set(id, snapshot);
    } catch {
      /* A crashed renderer may already be gone; keep its last known URL. */
    }
  }
  const needsInitialLoad = new Set<string>();
  const hibernatedServiceIds = new Set<string>();
  const loadingServiceIds = new Set<string>();
  const failedServiceIds = new Set<string>();
  const serviceLoadRetries = new Map<string, number>();
  /** URL a abrir na primeira carga da aba, no lugar da home (link do Meet). */
  const pendingServiceUrls = new Map<string, { url: string; at: number }>();
  /**
   * Reunião do Google Meet: chamada em andamento, "não perturbe", atalho do
   * microfone, mini-janela, registro no CRM e lembrete da agenda. Ver
   * meet-integration.ts. Tudo que é lido aqui dentro de lambdas existe quando
   * elas rodam (timers e eventos, depois de montada a janela).
   */
  const meet = createMeetIntegration({
    parentWindow: win,
    settings: () => ({
      meetQuietNotifications: appState.settings.meetQuietNotifications,
      meetMiniWindow: appState.settings.meetMiniWindow,
      meetMuteShortcut: appState.settings.meetMuteShortcut,
      meetLogToCrm: appState.settings.meetLogToCrm,
      calendarReminderMinutes: appState.settings.calendarReminderMinutes,
      notificationsEnabled: notifSettings().enabled !== false,
    }),
    meetViews: () => {
      const active = new Set(listActiveWorkspaces(appState).map((w) => w.id));
      return appState.services
        .filter((s) => s.kind === "meet" && active.has(s.workspaceId) && !s.deletedAt)
        .flatMap((s) => {
          const contents = serviceViews.get(s.id)?.webContents;
          return contents ? [[s.id, contents] as [string, WebContents]] : [];
        });
    },
    workspaceOf: (serviceId) =>
      appState.services.find((s) => s.id === serviceId && !s.deletedAt)?.workspaceId ?? null,
    onCallsChanged: () => {
      if (win.isDestroyed() || appQuitting) return;
      void patchAllNotificationSettings().catch(() => undefined);
      layout();
      broadcastState();
    },
    isQuitting: () => appQuitting || win.isDestroyed(),
    // Fora do asar (asarUnpack): o worker_threads lê o arquivo do disco.
    calendarWorkerPath: (() => {
      const file = path.join(opts.dirname, "calendar-worker.bundle.cjs").replace(
        `app.asar${path.sep}`,
        `app.asar.unpacked${path.sep}`,
      );
      return fs.existsSync(file) ? file : "";
    })(),
    calendarFeedUrl: () => calendarFeedUrl(),
    openMeetingUrl: (url) => {
      if (!openInMeetService(url)) void openInPreferredBrowser(url, preferredBrowser());
    },
    focusApp: () => {
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    },
    askText: async (title, hint, label, options) => {
      const answer = await showPrompt(title, options?.initial ?? "", options?.okLabel ?? "OK", false, hint, label, options?.allowEmpty === true);
      return answer === null ? null : answer.trim();
    },
    onCalendarChanged: () => broadcastState(),
    calendarFeedBroken: () => Boolean(appState.settings.calendarFeedSealed) && calendarFeedUrl() === null,
    callCrm: (targetWorkspaceId, apiPath, init) => opts.callCrmJson(targetWorkspaceId, apiPath, init),
    disableCrmLogPrompt: () => {
      appState = parseAppState({ ...appState, settings: { ...appState.settings, meetLogToCrm: false } });
      saveAppStateAtomic(statePath, appState);
      broadcastState();
      showToast("Pronto: o app não vai mais perguntar depois das reuniões.");
    },
    toast: (text) => showToast(text),
    log: (level, message, extra) => pushLog(level, message, extra),
  });
  win.on("closed", () => meet.dispose());
  // Acordou da suspensão: relê a agenda (timers atrasados já são descartados em
  // remind()) para os lembretes das próximas reuniões voltarem a valer.
  const refreshCalendarOnResume = (): void => void meet.refreshCalendar();
  powerMonitor.on("resume", refreshCalendarOnResume);
  win.on("closed", () => powerMonitor.removeListener("resume", refreshCalendarOnResume));
  /** WhatsApp/Gmail calados durante a reunião (o próprio Meet e o resto avisam). */
  function meetingQuietFor(serviceId: string): boolean {
    const kind = appState.services.find((s) => s.id === serviceId)?.kind;
    return (
      (kind === "whatsapp" || kind === "gmail") &&
      appState.settings.meetQuietNotifications &&
      meet.anyCall()
    );
  }
  /** Endereço iCal do lembrete, decifrado só na hora de usar. */
  function calendarFeedUrl(): string | null {
    const sealed = appState.settings.calendarFeedSealed;
    if (!sealed) return null;
    try {
      return safeStorage.decryptString(Buffer.from(sealed, "base64"));
    } catch {
      return null;
    }
  }
  /** Uma nova tentativa agendada por aba; recarregar à mão não empilha outra. */
  const serviceRetryTimers = new Map<string, NodeJS.Timeout>();
  /** Saídas do site no último minuto, por aba (WhatsApp para fora, Gmail para /intl/). */
  const whatsappBounces = new Map<string, number[]>();
  /** Quando cada aba se fechou sozinha (window.close) pela última vez. */
  const selfClosedAt = new Map<string, number>();
  const serviceCrashTimes = new Map<string, number[]>();
  const lastUsedAt = new Map<string, number>();
  const badgeUnread = new Map<string, number>();
  /** Quando e de quanto o contador caiu a 0 — ver isUnreadReloadBlip. */
  const unreadDrops = new Map<string, { count: number; at: number }>();
  const recovery = new CrashRecoveryRegistry();
  const downloads = new DownloadManager();
  const recentLogs: string[] = [];
  const pushLog = (level: string, message: string, extra?: unknown): void => {
    const line = safeLogLine(level, message, extra);
    recentLogs.push(line);
    if (recentLogs.length > 200) recentLogs.shift();
    if (level === "error") console.error(line);
  };
  let activeSurface: Surface = "empty";
  // O CRM é a porta de entrada do Workspace. Cada workspace possui uma sessão
  // CRM isolada; sem login, serviços ficam bloqueados, mas Configurações continua
  // acessível para diagnóstico e atualização (evita um deadlock de recuperação).
  const crmAuthenticatedWorkspaces = new Set<string>();
  /**
   * Workspaces cujo login já foi conferido ao menos uma vez. "Não autenticado"
   * de quem nunca foi conferido é desconhecido, não logout: tratado como
   * logout, a primeira ida a outro workspace dava "Faça login" falso e, quando a
   * conferência chegava, pulava para o primeiro serviço em vez do clicado.
   */
  const crmLoginKnown = new Set<string>();
  const crmGateWatched = new WeakSet<Electron.Session>();
  let crmGateTimer: NodeJS.Timeout | undefined;
  let paletteOpen = false;
  let notifPanelOpen = false;
  let toastVisible = false;
  let toastSize = { width: 420, height: 88 };
  let toastTimer: NodeJS.Timeout | undefined;
  const notifFeed: FeedItem[] = [];
  let updateState: DesktopUpdateState = {
    phase: "disabled",
    currentVersion: app.getVersion(),
    message: "Inicializando atualizador…",
  };
  /**
   * Zoom das views = SÓ a escala escolhida pelo usuário.
   *
   * Multiplicar por `display.scaleFactor` aplicava o DPI do Windows duas vezes: o
   * Chromium já renderiza a 150% num monitor a 150% (devicePixelRatio 1.5), e o
   * `setZoomFactor(1.5)` por cima dava 2,25×. Como titlebar, rail e painel não
   * levam zoom nenhum, WhatsApp e CRM ficavam 50% maiores que o resto do app —
   * dá para conviver com a janela maximizada, e vira "gigante do nada" assim que
   * ela diminui. Medido: `setZoomFactor(1.5)` numa tela 1× leva
   * `devicePixelRatio` a 1.5 e a viewport de 900 para 600 px CSS. Em tela a 100%
   * baseZoom dava 1 e o defeito não aparecia — por isso só doía em uma máquina.
   */
  function uiZoom(): number {
    return appState.settings.uiScale || 1;
  }

  /**
   * Zoom no Chromium é POR HOST e fica GRAVADO no `Preferences` da partição.
   *
   * `setZoomFactor` na criação da view roda ainda no `about:blank` (a primeira
   * navegação é adiada de propósito, ver `needsInitialLoad`), então grava o
   * nível no host "" — e o commit da navegação aplica por cima o que estiver
   * salvo para `web.whatsapp.com`. Foi assim que o 1.5 herdado de uma tela a
   * 200% sobreviveu a reinício, troca de monitor e troca de máquina: medido em
   * `Partitions/wa-<id>/Preferences`, `per_host_zoom_levels` = 2.2239 (fator
   * 1.5), ao lado de uma entrada "" que é justamente a chamada que não pegou.
   * Reaplicar no `did-navigate` é o que sobrescreve — e limpa — o valor salvo.
   *
   * Declaração de função, não `const`: `ensureCrmView` está centenas de linhas
   * ACIMA daqui e chama isto durante o boot. Com `const` o app subia com oito
   * processos e zero janelas (`Cannot access 'attachZoom' before
   * initialization`) — a mesma zona morta temporal do commit cb54535.
   */
  function attachZoom(contents: WebContents): void {
    contents.setZoomFactor(uiZoom());
    contents.on("did-navigate", () => contents.setZoomFactor(uiZoom()));
  }

  /**
   * Zoom de página do ADR Browser (Ctrl+= / Ctrl+- / Ctrl+roda) por SITE, por
   * cima do zoom da interface. Só em memória, como o resto do que o Browser
   * guarda da navegação: o attachZoom acima zera o nível gravado pelo Chromium
   * a cada navegação, e é este fator que vem depois e põe o do site de volta.
   */
  function sitePageZoom(contents: WebContents): number {
    // Só nas abas do Browser: o Gmail/YouTube dedicados (mesmo host) não têm
    // indicador nem como voltar a 100%, e herdavam o zoom dado na aba.
    if (opts.viewMeta.get(contents)?.kind !== "browser") return 1;
    try {
      return siteZoomLevels.get(new URL(contents.getURL()).hostname) ?? 1;
    } catch {
      return 1;
    }
  }
  function applyPageZoom(contents: WebContents): void {
    if (!contents.isDestroyed()) contents.setZoomFactor(uiZoom() * sitePageZoom(contents));
  }

  const notifSettings = (): NotificationSettings =>
    appState.settings.notifications || defaultNotifications();

  const preferredBrowser = (): ExternalBrowserPreference =>
    appState.settings.preferredExternalBrowser;

  const externalBrowserLabel = (): string => {
    const browser = preferredBrowser();
    return browser === "chrome" ? "Chrome" : browser === "brave" ? "Brave" : "navegador padrão";
  };

  // Lido uma vez: getLoginItemSettings() bate no registro do Windows e
  // shellStatePayload() roda a cada broadcast (download, badge, troca de aba).
  let autostartEnabled = app.getLoginItemSettings().openAtLogin;

  /**
   * "Limpar" zera o contador do ícone até o usuário IR OLHAR o serviço.
   *
   * Antes bastava chegar mensagem nova para o contador voltar. Numa conta com
   * conversa ativa isso é questão de segundos: o usuário limpava e o 99+ estava
   * de volta antes de ele tirar os olhos da barra — na prática "Limpar" não
   * fazia nada. Quem tem 131 não lidas acumuladas nunca ia zerar. Reabrir o
   * WhatsApp/Gmail é o sinal certo: aí ele está de fato lidando com a caixa.
   */
  let trayDismissed = false;

  /** Última vez na aba do CRM — alimenta a hibernação dela (ver enforceHibernation). */
  let crmLastUsedAt = Date.now();
  /** Último início/fim de som em qualquer serviço — reunião só ouvindo tem silêncios. */
  let lastAudibleAt = 0;

  /**
   * Contador no ícone da barra de tarefas — soma de todos os não lidos.
   * Windows usa overlay nativo de 16×16; `app.setBadgeCount` só cobre Linux/macOS.
   */
  /** Não lidas que aparecem: só as que chegaram depois de "Limpar notificações". */
  const visibleUnread = (id: string): number => {
    const raw = badgeUnread.get(id) || 0;
    return raw - Math.min(appState.settings.clearedUnread[id] ?? 0, raw);
  };

  const setClearedUnread = (id: string, base: number | undefined): void => {
    const clearedUnread = { ...appState.settings.clearedUnread };
    if (base === undefined) delete clearedUnread[id];
    else clearedUnread[id] = base;
    appState = parseAppState({ ...appState, settings: { ...appState.settings, clearedUnread } });
    saveStateSoon();
  };

  /** Contador de um serviço volta a zero (a fonte dele parou de valer: saiu da conta). */
  function clearServiceUnread(serviceId: string): void {
    unreadDrops.delete(serviceId);
    if (!badgeUnread.delete(serviceId)) return;
    refreshTrayBadge();
    broadcastState();
  }

  const refreshTrayBadge = (): void => {
    const total = [...badgeUnread.keys()].reduce((sum, id) => sum + visibleUnread(id), 0);
    const visibleCount = notifSettings().trayBadge && !trayDismissed ? total : 0;
    if (process.platform === "win32") {
      const png = createTaskbarBadgePng(visibleCount);
      win.setOverlayIcon(
        png ? nativeImage.createFromBuffer(png) : null,
        png ? describeTaskbarBadge(visibleCount) : "Sem mensagens não lidas",
      );
      return;
    }
    app.setBadgeCount(visibleCount);
  };

  const badgesPayload = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const id of badgeUnread.keys()) {
      const n = visibleUnread(id);
      if (n > 0) out[id] = n;
    }
    return out;
  };

  /**
   * A aba do ADR Browser que representa todas na barra lateral (um ícone só;
   * as abas estão na faixa): a ativa, se for deste workspace; senão a última
   * usada. Declaração de função: o payload da lateral nasce antes desta linha.
   */
  function railBrowserTab(wsId: string): string | undefined {
    const tabs = orderedServicesForWorkspace(appState, wsId).filter((s) => hasTabStrip(s.kind));
    if (!tabs.length) return undefined;
    const active = wsId === workspaceId ? activeService() : undefined;
    if (active && tabs.some((tab) => tab.id === active.id)) return active.id;
    return tabs.reduce((best, tab) =>
      (lastUsedAt.get(tab.id) ?? 0) > (lastUsedAt.get(best.id) ?? 0) ? tab : best,
    ).id;
  }
  /** Serviços do workspace como a lateral mostra: abas do Browser num ícone só. */
  function railServices(wsId: string): ServiceInstance[] {
    const ordered = orderedServicesForWorkspace(appState, wsId);
    return collapseBrowserServices(
      ordered,
      ordered.filter((s) => hasTabStrip(s.kind)).map((s) => s.id),
      railBrowserTab(wsId),
    );
  }
  function railOrder(wsId: string): string[] {
    return collapseRailBrowserTabs(
      railOrderForWorkspace(appState, wsId),
      orderedServicesForWorkspace(appState, wsId)
        .filter((s) => hasTabStrip(s.kind))
        .map((s) => s.id),
      railBrowserTab(wsId),
    );
  }
  /** "ADR Browser · 3 abas" no ícone que representa todas. */
  function railServiceName(service: ServiceInstance): string {
    if (!hasTabStrip(service.kind)) return service.name;
    const count = orderedServicesForWorkspace(appState, service.workspaceId).filter((s) =>
      hasTabStrip(s.kind),
    ).length;
    return count > 1 ? `${service.name} · ${count} abas` : service.name;
  }

  const shellStatePayload = () => ({
    platform: process.platform,
    services: railServices(workspaceId).map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      keepAwake: s.keepAwake,
      hibernateAfterMinutes: s.hibernateAfterMinutes,
      pinned: s.pinned,
      // Qual conta Google este serviço usa (undefined para WhatsApp/Instagram).
      googleAccountId: usesSharedGoogleSession(s.kind) ? s.profileId : undefined,
      microsoftAccountId: usesSharedMicrosoftSession(s.kind) ? s.profileId : undefined,
      ownSession: ownsSession(s.kind),
    })),
    googleAccounts: listGoogleProfilesForWorkspace(appState, workspaceId).map((p) => ({
      id: p.id,
      name: p.name,
    })),
    microsoftAccounts: listMicrosoftProfilesForWorkspace(appState, workspaceId).map((p) => ({
      id: p.id,
      name: p.name,
    })),
    // Só uma dica de conta para a URL do formulário — o app não guarda credencial
    // do Google Contacts.
    contactsAccount: contactsAccount() || "",
    // Ordem da barra lateral: ids dos serviços mais o marcador "crm", na ordem
    // em que foram arrastados. É a lista de ícones arrastáveis da tela.
    // Abas do ADR Browser num ícone só (railOrder/railServices).
    rail: railOrder(workspaceId),
    // A barra de TODOS os workspaces, para a lateral mostrar os ícones de todos
    // de uma vez. `services`/`rail` acima continuam só do workspace ativo — as
    // configurações valem só para ele.
    railGroups: listActiveWorkspaces(appState).map((w) => ({
      workspaceId: w.id,
      name: w.name,
      color: w.color,
      rail: railOrder(w.id),
      services: railServices(w.id).map((s) => ({
        id: s.id,
        name: railServiceName(s),
        kind: s.kind,
        pinned: s.pinned,
      })),
    })),
    workspaces: listActiveWorkspaces(appState).map((w) => ({
      id: w.id,
      name: w.name,
      color: w.color,
    })),
    activeWorkspaceId: workspaceId,
    catalog: SERVICE_CATALOG,
    chromeLayout: workspaceChromeLayout(),
    notifications: notifSettings(),
    downloads: downloads.list(),
    theme: appState.settings.theme,
    sidebarPosition: appState.settings.sidebarPosition,
    sidebarExpanded: appState.settings.sidebarExpanded,
    browserToolbarPosition: appState.settings.browserToolbarPosition,
    adBlockEnabled: appState.settings.adBlockEnabled,
    adBlockAllowlist: appState.settings.adBlockAllowlist,
    preferredExternalBrowser: appState.settings.preferredExternalBrowser,
    crmAudioMuted: appState.settings.crmAudioMuted,
    meet: {
      quietNotifications: appState.settings.meetQuietNotifications,
      miniWindow: appState.settings.meetMiniWindow,
      muteShortcut: appState.settings.meetMuteShortcut,
      logToCrm: appState.settings.meetLogToCrm,
      inCall: meet.anyCall(),
    },
    calendar: {
      configured: Boolean(appState.settings.calendarFeedSealed),
      reminderMinutes: appState.settings.calendarReminderMinutes,
      status: meet.calendarStatus(),
    },
    uiScale: appState.settings.uiScale,
    maxLoadedViews: appState.settings.maxLoadedViews ?? recommendedMaxLoadedViews(os.totalmem()),
    whatsappLock: {
      enabled:
        appState.settings.whatsappLockEnabled ||
        Object.values(appState.settings.whatsappLockServiceIds).some(Boolean),
      timeoutMinutes: appState.settings.whatsappLockTimeoutMinutes ?? 30,
      locked: appState.services.some(
        (s) => s.kind === "whatsapp" && isWhatsAppLocked(s.id) && !whatsappUnlocked.has(s.id),
      ),
      services: appState.services
        .filter((s) => s.kind === "whatsapp")
        .map((s) => ({
          id: s.id,
          name: s.name,
          enabled: isWhatsAppLocked(s.id),
          locked: isWhatsAppLocked(s.id) && !whatsappUnlocked.has(s.id),
          lockOnLeave: appState.settings.whatsappLockOnLeaveServiceIds[s.id] === true,
          timeoutMinutes: lockTimeoutMinutes(s.id),
        })),
    },
    activeSurface,
    badges: badgesPayload(),
    loadedServiceIds: [...serviceViews.keys()],
    hibernatedServiceIds: [...hibernatedServiceIds],
    loadingServiceIds: [...loadingServiceIds],
    failedServiceIds: [...failedServiceIds],
    autostart: autostartEnabled,
    feed: notifFeed,
    update: updateState,
    panel:
      activeSurface === "settings" || activeSurface === "notifications" || activeSurface === "empty"
        ? activeSurface
        : "settings",
  });

  /**
   * Último valor enviado de cada chave do estado (JSON). A cada broadcast vai só
   * o que mudou: antes o estado inteiro (catálogo de serviços, feed, downloads)
   * ia para as quatro telas a cada clique e a cada progresso de download, e cada
   * tela redesenhava tudo. As telas mesclam o que chega e pedem o estado
   * completo ao carregar (shell:get-state), então o diff não perde nada.
   */
  let lastBroadcast: Record<string, string> = {};
  const broadcastState = (): void => {
    // Chamado também depois de esperas longas (leitura da agenda, 20 s) e de
    // eventos no fechamento: com a janela já destruída, send() lançava.
    if (win.isDestroyed()) return;
    const payload = shellStatePayload() as Record<string, unknown>;
    const { changed, snapshot } = stateDiff(lastBroadcast, payload);
    lastBroadcast = snapshot;
    if (!changed) return;
    for (const view of [shellView, panel, overlay]) {
      if (!view.webContents.isDestroyed()) view.webContents.send("shell:state", changed);
    }
    // Aba criada, fechada, renomeada ou movida pela lateral: a faixa acompanha.
    pushBrowserTabs();
  };
  downloads.subscribe(() => broadcastState());

  /** Área dos serviços no último layout: o toast fica nela, não sobre a lateral. */
  let lastMain = { x: 0, y: titlebarHeight(), width: 0, height: 0 };
  const layoutOverlay = (): void => {
    const { width, height } = win.getContentBounds();
    if (paletteOpen || notifPanelOpen) {
      place(overlay, { x: 0, y: titlebarHeight(), width, height: Math.max(height - titlebarHeight(), 0) });
    } else if (toastVisible) {
      // Recortado no tamanho real do toast: a caixa fixa de 420×88 era uma view
      // transparente por cima do serviço, e todo clique naquele canto sumia.
      // No canto da área dos serviços: em x=0 cobria por 3 s os botões da
      // lateral (Configurações, recolher) e o clique só fechava o toast.
      const area = lastMain.width > 0 ? lastMain : { x: 0, y: 0, width, height };
      place(overlay, {
        x: area.x,
        y: Math.max(area.y + area.height - toastSize.height, 0),
        width: Math.min(toastSize.width, area.width),
        height: Math.min(toastSize.height, area.height),
      });
    } else {
      place(overlay, HIDDEN);
    }
    if (paletteOpen || notifPanelOpen || toastVisible) win.contentView.addChildView(overlay);
  };

  const showToast = (message: string): void => {
    overlay.webContents.send("shell:toast", message);
    toastVisible = true;
    layoutOverlay();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastVisible = false;
      layoutOverlay();
    }, 3400);
  };

  /** Item no sino + toast. `url`/`surface` tornam a linha clicável no slide-over. */
  const notify = (
    text: string,
    extra: { url?: string; surface?: string } = {},
    toast = true,
  ): void => {
    notifFeed.unshift({ id: randomUUID(), text, ts: Date.now(), read: false, ...extra });
    if (notifFeed.length > 50) notifFeed.length = 50;
    // "Limpei e voltou" só se investiga sabendo QUAL aviso entrou e quando.
    pushLog("info", "notificação", { texto: text.slice(0, 80), destino: extra.surface });
    if (toast) showToast(text);
    broadcastState();
  };

  /**
   * Conta em que o formulário de contato abre. Só uma dica de `authuser`: vazio
   * abre na conta padrão do navegador, que costuma ser a certa.
   */
  const contactsAccount = (): string | undefined =>
    appState.settings.contactsGoogleAccount || undefined;

  /**
   * Botão do painel do WhatsApp: abre o formulário de novo contato do Google
   * com nome e telefone preenchidos, para revisar e salvar lá.
   *
   * Nada é criado pelo app. Foi medido que o formulário aceita `givenname` e
   * `phone` na URL, e revisar antes de gravar é o que o usuário quer — então o
   * caminho da API (que criava direto) saiu daqui.
   */
  const saveGoogleContact = async (payload: {
    name?: unknown;
    phone?: unknown;
  }): Promise<{ opened: true; name: string | null }> => {
    const phone = toE164(String(payload.phone || ""));
    if (!phone) throw new Error("Esta conversa não tem telefone (grupo ou lista).");
    const name = String(payload.name || "").trim() || null;
    const url = newContactUrl(name, phone, contactsAccount());
    let opened = await openInPreferredBrowser(url, preferredBrowser());
    if (!opened.ok) opened = await openInPreferredBrowser(url, "auto");
    if (!opened.ok) {
      showToast(opened.message || "Não foi possível abrir o navegador");
      throw new Error(opened.message || "Não foi possível abrir o navegador");
    }
    pushLog("info", "contato aberto no google", { comNome: Boolean(name) });
    showToast(`Abrindo no Google Contacts: ${name || phone}`);
    return { opened: true, name };
  };
  opts.setSaveGoogleContact(saveGoogleContact);

  /**
   * "Agendar reunião" do painel do WhatsApp: evento do Google Calendar já
   * preenchido, com sala do Meet. Convidado = e-mail do contato no CRM, quando o
   * telefone da conversa bate com um contato. Abre na aba do Calendar do
   * workspace (já logada); sem ela, no navegador.
   */
  const scheduleMeeting = async (payload: { name?: unknown; phone?: unknown }): Promise<{ opened: true }> => {
    const { title, details } = meetingFromChat(payload);
    // Fixo antes do await: trocar de workspace durante a busca no CRM abria o
    // evento na agenda de outro workspace, com o convidado do primeiro.
    const ws = workspaceId;
    let guestEmail: string | null = null;
    // Só dígitos, como o lookup do painel do WhatsApp (index.ts): com "+55…" a
    // busca do CRM não achava o contato e o convidado nunca era preenchido.
    const phone = String(payload.phone || "").replace(/\D/g, "");
    if (phone) {
      try {
        const data = (await opts.callCrmJson(
          ws,
          `/api/crm/contacts?phone=${encodeURIComponent(phone)}&limit=1`,
          { signal: AbortSignal.timeout(5000) },
        )) as { items?: Array<{ email?: unknown }> } | null;
        const email = data?.items?.[0]?.email;
        if (typeof email === "string" && email.includes("@")) guestEmail = email;
      } catch {
        // Sem CRM, sem convidado: o evento abre do mesmo jeito.
      }
    }
    const calendar = appState.services.find(
      (s) => s.kind === "calendar" && s.workspaceId === ws && !s.deletedAt,
    );
    // Na aba do Calendar vale a conta logada nela; `authuser` de outra conta
    // trocaria a agenda. No navegador, a dica de conta do Google Contacts.
    if (calendar && openUrlInService(calendar.id, calendarEventTemplateUrl({ title, details, guestEmail }))) {
      pushLog("info", "agendar reunião", { destino: "calendar", convidado: Boolean(guestEmail) });
      return { opened: true };
    }
    const url = calendarEventTemplateUrl({ title, details, guestEmail, authuser: contactsAccount() ?? null });
    const opened = await openInPreferredBrowser(url, preferredBrowser());
    if (!opened.ok) {
      showToast(opened.message || "Não foi possível abrir a agenda");
      throw new Error(opened.message || "Não foi possível abrir a agenda");
    }
    pushLog("info", "agendar reunião", { destino: "navegador", convidado: Boolean(guestEmail) });
    return { opened: true };
  };
  opts.setScheduleMeeting(scheduleMeeting);

  // Estado ilegível no boot: o app abriu vazio. Sem aviso o usuário achava que
  // tinha perdido tudo e reconfigurava por cima da cópia intacta — e o
  // diagnóstico exportado também não dizia nada.
  if (quarantinedStateCopies.length) {
    pushLog(
      "error",
      restoredFromBackup ? "estado ilegível — app abriu o backup" : "estado ilegível — app recomeçou do zero",
      { copias: quarantinedStateCopies },
    );
    const text = restoredFromBackup
      ? "A configuração salva não pôde ser lida e o app abriu a cópia de segurança anterior. A versão ilegível foi guardada na pasta de dados (state.v1.json.corrupt-…)."
      : "A configuração salva não pôde ser lida e o app recomeçou do zero. Uma cópia dela foi guardada na pasta de dados (state.v1.json.corrupt-…).";
    // Sino: fica até o usuário ver, mesmo se o toast sair antes de a overlay carregar.
    // O diálogo vem depois do `win.show()` do final (ver showQuarantineNotice).
    notify(text, {}, false);
  }

  /**
   * Aberto só com a janela já visível: ela nasce com `show: false`, e no Windows
   * um diálogo cujo dono está oculto pode nascer escondido ou atrás dela.
   */
  const showQuarantineNotice = (): void => {
    if (!quarantinedStateCopies.length) return;
    void dialog
      .showMessageBox(win, {
        type: "warning",
        title: "Configuração recuperada",
        message: "A configuração salva não pôde ser lida",
        detail: `${restoredFromBackup ? "O ADR Workspace abriu a cópia de segurança anterior." : "O ADR Workspace recomeçou com uma configuração nova."} Nada foi apagado: a versão anterior está em\n${quarantinedStateCopies.join("\n")}\n\nEnvie este caminho ao suporte se precisar recuperá-la.`,
        buttons: ["Abrir pasta", "Fechar"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 0) shell.showItemInFolder(quarantinedStateCopies[0]!);
      });
  };

  const activeService = (): ServiceInstance | undefined => {
    if (!activeSurface.startsWith("service:")) return undefined;
    const id = activeSurface.slice("service:".length);
    return appState.services.find((s) => s.id === id && !s.deletedAt);
  };

  const activeServiceView = (): WebContentsView | undefined => {
    const svc = activeService();
    return svc ? serviceViews.get(svc.id) : undefined;
  };

  const vaultStateFor = (url: string) => {
    try {
      return { ...passwordVault.status(url), error: null };
    } catch {
      return {
        available: false,
        total: 0,
        matchCount: 0,
        origin: null,
        error: "Não foi possível abrir o cofre",
      };
    }
  };

  const pushBrowserToolbarState = (): void => {
    const view = activeServiceView();
    const svc = activeService();
    if (!view || !svc || !serviceNeedsChrome(svc)) return;
    const url = view.webContents.getURL();
    browserToolbar?.webContents.send("browser:url", url.startsWith("data:") ? "" : url);
    browserToolbar?.webContents.send("browser:nav", {
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
    });
    browserToolbar?.webContents.send("browser:adblock", {
      ...adBlocker.stateFor(view.webContents.id, url),
      externalBrowser: preferredBrowser(),
    });
    browserToolbar?.webContents.send("browser:vault", vaultStateFor(url));
    browserToolbar?.webContents.send("browser:loading", view.webContents.isLoading());
    browserToolbar?.webContents.send("browser:favicon", browserFavicons.get(svc.id) ?? null);
    browserToolbar?.webContents.send("browser:zoom", Math.round(sitePageZoom(view.webContents) * 100));
    if (linkTabChain && linkTabChain.opener !== svc.id) linkTabChain = null;
    // Sem `force`: isto roda a cada contador do bloqueador (250 ms) e cada
    // redesenho da faixa recriava as abas entre o mousedown e o mouseup — o
    // clique na aba ou no ✕ se perdia. Barra recarregada zera lastBrowserTabs.
    pushBrowserTabs();
    // A busca é de UMA página: trocou de aba, a caixa fecha e o destaque some.
    if (findTargetId !== null && findTargetId !== view.webContents.id) stopFind(true);
  };

  /** Abas do ADR Browser deste workspace, na ordem da barra lateral. */
  function browserTabServices(): ServiceInstance[] {
    return orderedServicesForWorkspace(appState, workspaceId).filter((s) => hasTabStrip(s.kind));
  }

  /**
   * Manda a faixa de abas para a barra. Chamado em toda mudança que a faixa
   * mostra (título, ícone, carregando, aba criada/fechada/movida); só vai pelo
   * IPC quando o conteúdo mudou, ou com `force` (barra recarregada).
   */
  function pushBrowserTabs(force = false): void {
    if (!browserToolbarLoaded || browserToolbar?.webContents.isDestroyed()) return;
    const active = activeService();
    if (!active || !hasTabStrip(active.kind)) return;
    const tabs: BrowserTabInfo[] = browserTabServices().map((svc) => {
      const contents = serviceViews.get(svc.id)?.webContents;
      const live = contents && !contents.isDestroyed() ? contents : undefined;
      const url = live?.getURL() || suspendedBrowserUrls.get(svc.id) || svc.startUrl;
      const pageTitle = live?.getTitle() || browserTitles.get(svc.id) || "";
      return {
        id: svc.id,
        title: tabTitle(pageTitle, url, svc.name),
        favicon: browserFavicons.get(svc.id) ?? null,
        loading: Boolean(live?.isLoading()),
        active: svc.id === active.id,
        url: url.startsWith("data:") ? "" : url.slice(0, 300),
        audible: Boolean(live?.isCurrentlyAudible()),
        muted: live ? live.isAudioMuted() : mutedBrowserTabs.has(svc.id),
      };
    });
    const payload = {
      tabs,
      edge: appState.settings.browserToolbarPosition === "bottom" ? "bottom" : "top",
    };
    const json = JSON.stringify(payload);
    if (!force && json === lastBrowserTabs) return;
    lastBrowserTabs = json;
    browserToolbar?.webContents.send("browser:tabs", payload);
  }

  function stopFind(closeToolbarBox: boolean): void {
    if (findTargetId === null) return;
    const contents = webContents.fromId(findTargetId);
    findTargetId = null;
    // "keepSelection": o resultado ativo fica selecionado, como no Chrome. É o
    // que devolve a seleção que o Ctrl+F encolheu para começar a busca nela.
    if (contents && !contents.isDestroyed()) contents.stopFindInPage("keepSelection");
    if (closeToolbarBox) browserToolbar?.webContents.send("browser:find-close");
  }

  /** Recarregar vira "parar" enquanto a aba ativa carrega. */
  const pushBrowserLoading = (view: WebContentsView): void => {
    if (activeServiceView() !== view || view.webContents.isDestroyed()) return;
    browserToolbar?.webContents.send("browser:loading", view.webContents.isLoading());
  };

  const configureSpellChecker = (ses: Electron.Session): void => {
    // No macOS o corretor é o do sistema e a lista de idiomas não se aplica.
    if (process.platform === "darwin" || spellcheckSessions.has(ses)) return;
    spellcheckSessions.add(ses);
    try {
      const languages = pickSpellCheckerLanguages(ses.availableSpellCheckerLanguages);
      if (languages.length) ses.setSpellCheckerLanguages(languages);
    } catch (error) {
      pushLog("error", "spellcheck", String(error));
    }
  };

  let adBlockToolbarTimer: NodeJS.Timeout | undefined;
  const adBlocker = new AdBlockManager(
    path.join(app.getPath("userData"), "adblock", "network-domains.v1.json"),
    () => appState.settings.adBlockEnabled,
    () => appState.settings.adBlockAllowlist,
    (contentsId) => {
      const contents = webContents.fromId(contentsId);
      if (!contents || opts.viewMeta.get(contents)?.kind !== "browser") return "";
      return contents.getURL();
    },
    (contentsId) => {
      const active = activeServiceView();
      if (!active || active.webContents.id !== contentsId) return;
      clearTimeout(adBlockToolbarTimer);
      adBlockToolbarTimer = setTimeout(pushBrowserToolbarState, 250);
    },
  );
  void adBlocker.initialize().then(pushBrowserToolbarState);

  /**
   * Aba tocando som NÃO é aba de fundo.
   *
   * Toda troca de superfície passa por `hideAllServiceViews`, que esconde a view
   * (`setVisible(false)` — é o que faz o throttling do Chromium valer, ver o
   * comentário em `place`) e liga o throttling. Para áudio isso é fatal: a fila
   * do player é alimentada por timers, e estrangulados eles entregam o buffer
   * atrasado — o som pica. Chrome e Brave isentam a aba AUDÍVEL exatamente por
   * isso; era essa a diferença entre ouvir YouTube aqui e no Brave.
   *
   * A view continua escondida, então a memória de aba oculta segue sendo
   * devolvida e a hibernação segue valendo. Só o relógio dela deixa de ser
   * estrangulado, e só enquanto houver som.
   */
  const applyBackgroundThrottle = (view: WebContentsView, active: boolean): void => {
    // Fechar uma aba que tocava som dispara o "audio-state-changed" (som parou)
    // DURANTE a destruição, quando a view já soltou o webContents: ler
    // `isDestroyed` de undefined virava erro de main ao sair do app.
    const contents = view.webContents as WebContents | undefined;
    if (!contents || contents.isDestroyed()) return;
    // Reunião do Meet em segundo plano com todos calados não é "audível", e
    // estrangulada a câmera/apresentação engasgava para os outros.
    contents.setBackgroundThrottling(
      !active && !contents.isCurrentlyAudible() && !meet.inCall(contents),
    );
  };

  const hideAllServiceViews = (keep?: WebContentsView): void => {
    for (const view of [...serviceViews.values(), ...crmViews.values()]) {
      if (view === keep) continue;
      place(view, HIDDEN);
      applyBackgroundThrottle(view, false);
    }
    if (browserToolbar) place(browserToolbar, HIDDEN);
  };

  const kickResize = (contents: WebContents | undefined): void => {
    // Também roda por timer (400 ms e 1,6 s depois do load): a view pode ter
    // sido fechada, recriada ou removida nesse meio.
    if (!contents || contents.isDestroyed() || contents.isLoadingMainFrame() || isGoogleAccountsUrl(contents.getURL())) return;
    void contents
      .executeJavaScript(
        `window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('orientationchange'));`,
        true,
      )
      .catch(() => undefined);
  };

  const ensureServiceLoaded = (serviceId: string): void => {
    if (!needsInitialLoad.has(serviceId)) return;
    const view = serviceViews.get(serviceId);
    const svc = appState.services.find((s) => s.id === serviceId);
    if (!view || !svc) return;
    const bounds = view.getBounds();
    if (bounds.width < 200 || bounds.height < 200) return;
    needsInitialLoad.delete(serviceId);
    view.webContents.setBackgroundThrottling(false);
    const pendingEntry = pendingServiceUrls.get(serviceId);
    pendingServiceUrls.delete(serviceId);
    // Pedido de mais de 1 min (a aba não chegou a ter tamanho): não reabrir um
    // convite velho quando a pessoa entrar na aba por conta própria.
    const pending =
      pendingEntry && Date.now() - pendingEntry.at < 60_000 ? pendingEntry.url : undefined;
    const restoreUrl =
      pending ??
      (svc.kind === "browser"
        ? browserRestoreUrl(svc.startUrl, suspendedBrowserUrls.get(svc.id))
        : serviceHome(svc));
    const history = !pending && svc.kind === "browser" ? suspendedBrowserHistory.get(svc.id) : undefined;
    suspendedBrowserHistory.delete(svc.id);
    if (history) {
      void view.webContents.navigationHistory.restore(history).catch(() => {
        if (
          serviceViews.get(serviceId) === view &&
          !view.webContents.isDestroyed() &&
          !view.webContents.getURL()
        ) {
          void view.webContents.loadURL(restoreUrl);
        }
      });
    } else {
      void view.webContents.loadURL(restoreUrl);
    }
    // QR do WhatsApp e apps do Google às vezes precisam de um segundo layout depois da primeira pintura.
    setTimeout(() => kickResize(view.webContents), 400);
    setTimeout(() => kickResize(view.webContents), 1600);
  };

  const reloadActiveSurface = (hard = false): void => {
    if (activeSurface === "crm") {
      const view = ensureCrmView(workspaceId);
      // Recarregar recarrega a página ONDE a view está. Parada no cartão de erro
      // (um data:) ou em outro site, "recarregar" repintava o próprio erro para
      // sempre — o sintoma de "atualizo e não volta". Fora do CRM, recarregar
      // significa voltar para o CRM.
      if (!isCrmUrl(view.webContents.getURL())) {
        loadCrmUrl(workspaceId);
        return;
      }
      if (hard) view.webContents.reloadIgnoringCache();
      else view.webContents.reload();
      return;
    }
    if (
      activeSurface === "settings" ||
      activeSurface === "notifications" ||
      activeSurface === "empty"
    ) {
      if (hard) panel.webContents.reloadIgnoringCache();
      else panel.webContents.reload();
      return;
    }
    if (activeSurface.startsWith("service:")) {
      const id = activeSurface.slice("service:".length);
      const view = serviceViews.get(id);
      const svc = appState.services.find((s) => s.id === id);
      if (!view) return;
      if (needsInitialLoad.has(id)) {
        ensureServiceLoaded(id);
        return;
      }
      // Mesma regra do CRM logo acima: parada num Docs, num login ou num cartão
      // de erro (`data:`), "recarregar" repintava o lugar errado para sempre.
      // Fora do site do serviço, recarregar significa voltar para o serviço.
      if (
        svc &&
        svc.kind !== "browser" &&
        (hard || serviceDriftedOffSite(svc.kind, view.webContents.getURL(), serviceHome(svc)))
      ) {
        void view.webContents.loadURL(serviceHome(svc));
        return;
      }
      if (hard) view.webContents.reloadIgnoringCache();
      else view.webContents.reload();
    }
  };

  function titlebarHeight(): number {
    return Math.round(TITLEBAR_PX * uiZoom());
  }

  function workspaceChromeLayout() {
    const { width, height } = win.getContentBounds();
    const scale = uiZoom();
    const horizontal =
      appState.settings.sidebarPosition === "top" || appState.settings.sidebarPosition === "bottom";
    const expanded =
      appState.settings.sidebarExpanded && (horizontal || width / scale >= SHELL_EXPANDED_RAIL_PX + 200);
    const railPx = horizontal || !expanded ? SHELL_RAIL_PX : SHELL_EXPANDED_RAIL_PX;
    return {
      ...calculateWorkspaceLayout(width, height, appState.settings.sidebarPosition, titlebarHeight(), Math.round(railPx * scale)),
      expanded,
      width,
    };
  }

  let lastCrmSurfaceLog = "";
  const layout = (): void => {
    refreshWhatsAppPrivacy();
    const { width, height } = win.getContentBounds();
    const chromeLayout = workspaceChromeLayout();
    const { main } = chromeLayout;
    place(shellView, { x: 0, y: 0, width, height });
    shellView.webContents.send("shell:layout", chromeLayout);
    lastMain = main;
    if (promptResolve) {
      place(promptOverlay, { x: 0, y: titlebarHeight(), width, height: Math.max(height - titlebarHeight(), 0) });
      win.contentView.addChildView(promptOverlay);
    }
    layoutOverlay();
    // Reunião do Meet com outra coisa na frente: a chamada continua visível num
    // canto, por cima do serviço (ver meet-integration.ts). Calculada antes de
    // esconder as abas para não piscar a dela a cada resize.
    const mini = meet.miniWindowFor(
      activeSurface.startsWith("service:") ? activeSurface.slice("service:".length) : null,
      main,
    );
    const miniView = mini ? serviceViews.get(mini.serviceId) : undefined;
    hideAllServiceViews(miniView);
    place(panel, HIDDEN);

    if (activeSurface === "crm") {
      const view = ensureCrmView(workspaceId);
      place(view, main);
      // Depois do place: é aqui que a view ganha tamanho pela primeira vez, e a
      // primeira navegação esperava exatamente por isso.
      ensureCrmLoaded(workspaceId);
      // A "tela preta" não deixa rastro: não crasha e não falha o load, então
      // nenhum evento dispara e o diagnóstico sai vazio. Estas quatro medidas
      // separam as hipóteses que sobraram — url `data:` é o cartão de erro,
      // bounds zerado é problema de layout, crashed é renderer morto, e url do
      // CRM com bounds bom significa página carregada renderizando vazio (aí é
      // do lado do app web, não daqui).
      // Só quando muda: o layout roda a cada passo do resize, e uma linha por
      // passo empurrava os erros de verdade para fora do buffer de 200.
      const crmSurfaceLog = {
        url: view.webContents.getURL().slice(0, 120),
        bounds: `${main.width}x${main.height}`,
        crashed: view.webContents.isCrashed(),
        loading: view.webContents.isLoading(),
      };
      const crmSurfaceKey = JSON.stringify(crmSurfaceLog);
      if (crmSurfaceKey !== lastCrmSurfaceLog) pushLog("info", "crm surface", crmSurfaceLog);
      lastCrmSurfaceLog = crmSurfaceKey;
      view.webContents.setBackgroundThrottling(false);
      kickResize(view.webContents);
    } else if (
      activeSurface === "settings" ||
      activeSurface === "notifications" ||
      activeSurface === "empty"
    ) {
      ensurePanel();
      place(panel, main);
      panel.webContents.send("shell:panel", activeSurface);
    } else if (activeSurface.startsWith("service:")) {
      const id = activeSurface.slice("service:".length);
      // Excluído nunca volta por aqui: o próximo resize recriava a view dele.
      const svc = appState.services.find((s) => s.id === id && !s.deletedAt);
      if (!svc) return raiseOverlays();
      const view = ensureServiceView(svc);
      const fullscreen = htmlFullscreenServiceId === svc.id;
      const chrome = !fullscreen && serviceNeedsChrome(svc);
      if (fullscreen) {
        // Vídeo em tela cheia: a view cobre a janela inteira, por cima da barra
        // de título e da lateral (ver o addChildView no fim do layout).
        place(view, { x: 0, y: 0, width, height });
      } else if (chrome) {
        const toolbar = ensureBrowserToolbar();
        const toolbarPosition = appState.settings.browserToolbarPosition || "top";
        // A faixa de abas mora na mesma view da barra: a página da barra mostra
        // a faixa quando a view tem altura para ela (ver browser-toolbar.html).
        const toolbarPx = BROWSER_TOOLBAR_PX + (hasTabStrip(svc.kind) ? BROWSER_TABSTRIP_PX : 0);
        if (toolbarPosition === "bottom") {
          place(toolbar, {
            x: main.x,
            y: main.y + main.height - toolbarPx,
            width: main.width,
            height: toolbarPx,
          });
          place(view, {
            x: main.x,
            y: main.y,
            width: main.width,
            height: Math.max(main.height - toolbarPx, 0),
          });
        } else {
          place(toolbar, {
            x: main.x,
            y: main.y,
            width: main.width,
            height: toolbarPx,
          });
          place(view, {
            x: main.x,
            y: main.y + toolbarPx,
            width: main.width,
            height: Math.max(main.height - toolbarPx, 0),
          });
        }
      } else {
        place(view, main);
      }
      view.webContents.setBackgroundThrottling(false);
      ensureServiceLoaded(id);
      kickResize(view.webContents);
      if (chrome) pushBrowserToolbarState();
    }
    if (miniBar && !meet.anyCall() && !miniBar.webContents.isDestroyed()) {
      // Reunião acabou: a barra não volta até a próxima, e o renderer dela ia junto.
      win.contentView.removeChildView(miniBar);
      closeView(miniBar);
      miniBar = null;
    } else if (miniBar) place(miniBar, HIDDEN);
    miniServiceId = "";
    if (mini && miniView && !miniView.webContents.isDestroyed()) {
      const { x, y, width, height } = mini.bounds;
      place(miniView, { x, y: y + MINI_BAR_PX, width, height: Math.max(80, height - MINI_BAR_PX) });
      const bar = ensureMiniBar();
      place(bar, { x, y, width, height: MINI_BAR_PX });
      win.contentView.addChildView(miniView);
      win.contentView.addChildView(bar);
      applyBackgroundThrottle(miniView, true);
      miniServiceId = mini.serviceId;
    }
    if (htmlFullscreenServiceId) {
      const fullscreenView = serviceViews.get(htmlFullscreenServiceId);
      if (!fullscreenView || fullscreenView.webContents.isDestroyed()) {
        // A aba morreu em tela cheia: o leave-html-full-screen nunca vem.
        setImmediate(endPageFullscreen);
      } else if (activeSurface === `service:${htmlFullscreenServiceId}`) {
        win.contentView.addChildView(fullscreenView);
      } else {
        // Trocou de aba (Ctrl+1…) com o vídeo em tela cheia: a página sai dela
        // e o leave-html-full-screen devolve a janela ao normal.
        void fullscreenView.webContents
          .executeJavaScript(
            "document.fullscreenElement ? (document.exitFullscreen(), true) : false",
            true,
          )
          .then((exiting: unknown) => {
            if (!exiting) endPageFullscreen();
          })
          .catch(() => endPageFullscreen());
      }
    }
    raiseOverlays();
  };

  function endPageFullscreen(): void {
    if (!htmlFullscreenServiceId) return;
    htmlFullscreenServiceId = null;
    if (windowFullscreenByPage && !win.isDestroyed()) win.setFullScreen(false);
    windowFullscreenByPage = false;
    if (!win.isDestroyed()) layout();
  }

  /**
   * View criada dentro do layout (ensureServiceView/ensureCrmView) entra no topo
   * da pilha, por cima do painel de notificações e do prompt de PIN que o
   * layout acabou de posicionar. Devolve os dois ao topo, na mesma ordem.
   */
  function raiseOverlays(): void {
    if (promptResolve) win.contentView.addChildView(promptOverlay);
    if (paletteOpen || notifPanelOpen || toastVisible) win.contentView.addChildView(overlay);
  }

  let stateSaveTimer: NodeJS.Timeout | undefined;
  /**
   * Gravação adiada para o que muda a todo clique (aba ativa, base de "Limpar
   * notificações"): o save faz fsync duas vezes no processo main, e em disco
   * lento a UI travava. Só se perde a última mudança se o app cair em 2 s, e
   * qualquer save imediato antes disso já grava o appState com ela.
   */
  const saveStateSoon = (): void => {
    clearTimeout(stateSaveTimer);
    stateSaveTimer = setTimeout(flushStateSave, 2000);
  };
  /**
   * Grava agora o que estava esperando o timer. Sair, reiniciar o Windows ou
   * instalar atualização dentro dos 2 s perdia a mudança — "Limpar notificações"
   * e logo fechar trazia o contador de volta no boot seguinte.
   */
  function flushStateSave(): void {
    if (!stateSaveTimer) return;
    clearTimeout(stateSaveTimer);
    stateSaveTimer = undefined;
    try {
      saveAppStateAtomic(statePath, appState);
    } catch (error) {
      pushLog("error", "salvar estado", { erro: String(error) });
    }
  }
  const pendingNotificationChats = new Map<string, string>();
  const showSurface = (surface: Surface, userInitiated = false): void => {
    const serviceId = surface.startsWith("service:") ? surface.slice("service:".length) : "";
    const service = serviceId
      ? appState.services.find((item) => item.id === serviceId && !item.deletedAt)
      : undefined;
    if (serviceId && !service) return;
    if (userInitiated && service && failedServiceIds.has(service.id) && !serviceViews.has(service.id)) {
      // Explicitly reopening a failed tab grants a fresh, bounded recovery try.
      serviceCrashTimes.delete(service.id);
    }
    // Clique em notificação e recuperação em segundo plano também vão para o workspace do serviço.
    if (service && !activateWorkspace(service.workspaceId)) return;
    if (!crmSurfaceAllowedWithoutLogin(surface) && !crmAuthenticatedWorkspaces.has(workspaceId)) {
      // A conversa do clique na notificação não abre agora; sem apagar, ela
      // abria muito depois, quando o usuário entrasse no WhatsApp por conta própria.
      if (service) pendingNotificationChats.delete(service.id);
      showToast("Faça login no CRM para desbloquear o Workspace.");
      if (activeSurface !== "crm") activeSurface = "crm";
      layout();
      return;
    }
    if (service?.kind === "whatsapp" && isWhatsAppLocked(service.id)) {
      const now = Date.now();
      const lastActive = whatsappLastActive.get(service.id) || 0;
      const timeoutMs = lockTimeoutMs(service.id);
      if (whatsappUnlocked.has(service.id) && whatsappLockExpired(lastActive, timeoutMs, now)) {
        whatsappUnlocked.delete(service.id);
        whatsappLastActive.delete(service.id);
      }
      if (!whatsappUnlocked.has(service.id)) {
        // Não entrou no WhatsApp bloqueado, mas activateWorkspace pode já ter
        // trocado de workspace (e bloqueado o WhatsApp de onde o usuário saiu):
        // sem redesenhar, a tela ficava num workspace e a barra lateral no outro.
        const stayPut = (): void => {
          layout();
          broadcastState();
        };
        if (whatsappUnlockPromptOpen) return stayPut();
        const lockoutMs = pinThrottle.remainingLockoutMs(
          whatsappLockFor(service.id).throttleKey,
          now,
        );
        if (lockoutMs > 0) {
          showToast(pinLockoutMessage(lockoutMs));
          return stayPut();
        }
        whatsappUnlockPromptOpen = true;
        const promptTitle = service.name
          ? `WhatsApp bloqueado: ${service.name}`
          : "WhatsApp bloqueado";
        void askPin(
          promptTitle,
          "",
          "Desbloquear",
          true,
          "Digite o PIN de 4 a 12 dígitos para acessar esta sessão.",
          "PIN",
        ).then((pin) => {
          whatsappUnlockPromptOpen = false;
          if (!pin) {
            pendingNotificationChats.delete(service.id);
            return stayPut();
          }
          const lock = whatsappLockFor(service.id);
          const pinState = lock.pinState();
          if (pinState !== "ok") {
            // Chaveiro travado não é PIN perdido: a recuperação recusa nesse caso
            // (shell:disable-whatsapp-lock), então mandar o usuário para lá era beco.
            showToast(
              pinState === "unavailable"
                ? LOCK_STORAGE_UNAVAILABLE.message
                : "PIN indisponível. Abra Configurações > Privacidade para recuperar o bloqueio",
            );
            return stayPut();
          }
          const verified = verifyWhatsAppPin(lock, pin);
          if (!verified.ok) {
            showToast(verified.message);
            return stayPut();
          }
          whatsappUnlocked.add(service.id);
          whatsappLastActive.set(service.id, Date.now());
          showSurface(surface);
        });
        return stayPut();
      }
      whatsappLastActive.set(service.id, now);
    }
    const previousService = activeService();
    if (
      previousService?.kind === "whatsapp" &&
      previousService.id !== serviceId &&
      appState.settings.whatsappLockOnLeaveServiceIds[previousService.id]
    ) {
      whatsappUnlocked.delete(previousService.id);
      whatsappLastActive.delete(previousService.id);
    }
    activeSurface = surface;
    if (surface === "crm") {
      crmLastUsedAt = Date.now();
      // Aqui, e não no layout(): layout roda a cada evento de resize e encheria o
      // log. showSurface roda no clique — que é exatamente quando o usuário está
      // vendo a tela preta e vai exportar o diagnóstico. O DOM é medido depois do
      // place/kickResize desta mesma passada, por isso o atraso.
      setTimeout(() => probeCrmDom(workspaceId, "aberta"), 1200);
    }
    if (surface.startsWith("service:")) {
      const sid = surface.slice("service:".length);
      lastUsedAt.set(sid, Date.now());
      // Abrir a caixa é o que rearma o contador do ícone depois de "Limpar":
      // daí em diante o número que aparecer é de mensagem que chegou com o
      // usuário já ciente, e não o mesmo 99+ acumulado que ele acabou de tirar.
      const kind = appState.services.find((s) => s.id === sid)?.kind;
      if (kind === "whatsapp" || kind === "gmail" || kind === "outlook" || kind === "teams") {
        trayDismissed = false;
        refreshTrayBadge();
      }
      // Só grava quando muda de fato: showSurface roda a cada clique no ícone e
      // saveAppStateAtomic faz fsync — reclicar a mesma aba escrevia disco à toa.
      if (appState.activeServiceId !== sid) {
        appState = parseAppState({ ...appState, activeServiceId: sid });
        saveStateSoon();
      }
    }
    layout();
    focusActiveSurface();
    if (service?.kind === "whatsapp" && pendingNotificationChats.has(service.id)) {
      const title = pendingNotificationChats.get(service.id)!;
      pendingNotificationChats.delete(service.id);
      const view = serviceViews.get(service.id);
      if (view) {
        void view.webContents
          .executeJavaScript(openWhatsAppNotificationChatScript(title), true)
          .then((opened) => {
            if (!opened && activeSurface === surface) {
              showToast("Não foi possível localizar a conversa desta notificação no WhatsApp.");
            }
          })
          .catch(() => undefined);
      }
    }
    void enforceHibernation();
    shellView.webContents.send("shell:shown", surface);
    broadcastState();
  };

  const crmSessionHasLogin = async (wsId: string): Promise<boolean> => {
    const crmSession = session.fromPartition(crmLoginPartition(wsId));
    const [token, tenant, impersonation] = await Promise.all([
      crmSession.cookies.get({ url: CRM_URL, name: "auth_token" }),
      crmSession.cookies.get({ url: CRM_URL, name: "tenant_id" }),
      crmSession.cookies.get({ url: CRM_URL, name: "adr_impersonation_session" }),
    ]);
    return hasCrmAuthenticatedSession({
      authToken: token[0]?.value,
      tenantId: tenant[0]?.value,
      impersonation: impersonation[0]?.value,
    });
  };

  function armCrmGate(wsId: string): void {
    if (crmGateTimer) clearInterval(crmGateTimer);
    const check = async (): Promise<void> => {
      if (win.isDestroyed()) return;
      const loggedIn = await crmSessionHasLogin(wsId).catch(() => false);
      if (win.isDestroyed()) return;
      const wasLoggedIn = crmAuthenticatedWorkspaces.has(wsId);
      const known = crmLoginKnown.has(wsId);
      crmLoginKnown.add(wsId);
      if (loggedIn) crmAuthenticatedWorkspaces.add(wsId);
      else crmAuthenticatedWorkspaces.delete(wsId);
      if (wsId !== workspaceId) return;
      // Só o login que ACONTECEU agora leva ao primeiro serviço; a primeira
      // conferência de um workspace só registra o estado.
      if (loggedIn && !wasLoggedIn && known) {
        // Some com o aviso de login velho assim que o CRM termina de entrar, em vez
        // de esperar o prazo do toast.
        toastVisible = false;
        clearTimeout(toastTimer);
        layoutOverlay();
        const first = shellStatePayload().services[0];
        if (first) showSurface(`service:${first.id}`);
        else showSurface("empty");
        if (crmViews.size) {
          pushLog("info", "hibernate crm view", workspaceId);
          closeInactiveCrmViews("");
        }
      } else if (!loggedIn && wasLoggedIn && activeSurface !== "crm") {
        showSurface("crm");
      }
    };
    void check();
    const ses = session.fromPartition(crmLoginPartition(wsId));
    if (!crmGateWatched.has(ses)) {
      crmGateWatched.add(ses);
      ses.cookies.on("changed", (_event, cookie) => {
        if (["auth_token", "tenant_id", "adr_impersonation_session"].includes(cookie.name)) {
          void check();
        }
      });
    }
    crmGateTimer = setInterval(() => void check(), 15_000);
  }

  /**
   * Trocar de aba deixava o foco onde estava: na rail (shellView), que foi quem
   * recebeu o clique. Duas consequências.
   *
   * A primeira é digitar — abrir o WhatsApp pelo ícone e sair teclando mandava as
   * teclas para uma view sem campo nenhum.
   *
   * A segunda é a área de transferência: `navigator.clipboard.write()` exige
   * `document.hasFocus()`, e é dele que sai o "Copiar" do menu da mensagem do
   * WhatsApp. Com o foco na rail, mesmo com a permissão concedida, a promessa
   * rejeita com "Document is not focused" — de novo sem diálogo e sem erro
   * visível, de novo o Ctrl+V da outra conversa colando o nada.
   *
   * Não rouba foco de quem está por cima: com o prompt modal, a paleta (Ctrl+K)
   * ou o painel de notificações abertos, quem manda é a overlay.
   */
  function focusActiveSurface(): void {
    if (promptResolve || paletteOpen || notifPanelOpen) return;
    if (activeSurface === "crm") {
      crmViews.get(workspaceId)?.webContents.focus();
      return;
    }
    if (activeSurface.startsWith("service:")) {
      activeServiceView()?.webContents.focus();
    }
  }

  /**
   * Leva a aba do CRM a um caminho interno. O destino é resolvido contra a URL
   * do CRM e conferido depois: `//outro.site/x` e `https://outro/` resolvem para
   * outra origem e são recusados — quem pede a navegação é um script injetado na
   * página do WhatsApp, que é conteúdo de terceiro.
   */
  const openCrmPath = (path: string): void => {
    let destino: URL;
    try {
      destino = new URL(path, CRM_URL);
    } catch {
      return;
    }
    if (!isCrmUrl(destino.toString())) return;
    ensureCrmView(workspaceId);
    loadCrmUrl(workspaceId, destino.toString());
  };
  opts.setShowCrmSurface((path, targetWorkspaceId) => {
    if (targetWorkspaceId && !activateWorkspace(targetWorkspaceId)) return;
    showSurface("crm");
    if (path) openCrmPath(path);
  });

  /** Chave de notificações do app + clique que foca o serviço (WhatsApp e Gmail). */
  /**
   * O que o guard de notificações da página lê (window.__adrNotifSettings), na
   * injeção e em cada atualização — um lugar só, para as duas não divergirem.
   */
  function guardSettingsFor(serviceId: string) {
    const settings = notifSettings();
    return {
      ...settings,
      enabled: serviceNotificationsOn(settings, serviceId),
      // Sessão protegida por PIN: o toast do Windows não mostra o texto da
      // mensagem — senão o bloqueio escondia a tela e a prévia aparecia igual.
      hidePreview:
        appState.services.find((s) => s.id === serviceId)?.kind === "whatsapp" &&
        isWhatsAppLocked(serviceId),
      // Numa reunião do Meet, WhatsApp e Gmail ficam calados (preferência).
      meetingQuiet: meetingQuietFor(serviceId),
    };
  }

  const injectNotificationGuard = async (
    view: WebContentsView,
    serviceId: string,
  ): Promise<void> => {
    if (isGoogleAccountsUrl(view.webContents.getURL())) return;
    await view.webContents.executeJavaScript(
      buildNotificationGuard(JSON.stringify(guardSettingsFor(serviceId)), serviceId),
      true,
    );
  };

  const injectWhatsAppGuards = async (view: WebContentsView, serviceId: string): Promise<void> => {
    if (!view.webContents.getURL().startsWith("https://web.whatsapp.com/")) return;
    try {
      await injectNotificationGuard(view, serviceId);
      // Mundo da ponte adrCrm (ver CRM_WORLD_ID): o guard acima fica no mundo da
      // página porque troca o window.Notification dela; estes não.
      const inCrmWorld = (code: string): Promise<unknown> =>
        view.webContents.executeJavaScriptInIsolatedWorld(CRM_WORLD_ID, [{ code }], true);
      await inCrmWorld(SAVE_CONTACT_BUTTON);
      if (shouldMountCrmPanel(opts.getCrmPanelKillSwitch(), false)) {
        const result = await inCrmWorld(extensionScript);
        if (result && result !== "ok" && result !== "already") {
          console.error("extension inject result", result);
        }
      }
    } catch (error) {
      // Só loga. Derrubar o kill switch aqui matava o painel/tradução/transcrição
      // em TODOS os WhatsApps, para o resto da sessão, sem aviso e sem botão de
      // volta (o `shell:crm-panel` não está em nenhuma tela). E a falha típica é
      // transitória: a view hiberna (10 min) ou recarrega no meio do
      // executeJavaScript e a promise rejeita com o frame destruído. O próximo
      // did-finish-load reinjeta. O kill switch fica para o que ele foi feito:
      // extensão ausente e desligar manual.
      console.error("whatsapp inject failed", error);
    }
  };

  const patchAllNotificationSettings = async (): Promise<void> => {
    const targets: Array<[string, WebContentsView]> = [];
    for (const [serviceId, view] of serviceViews) {
      const kind = appState.services.find((s) => s.id === serviceId)?.kind;
      if (kind === "whatsapp" || kind === "gmail") targets.push([serviceId, view]);
    }
    // O CRM entra aqui também: sem isto, desligar a chave dele só valia depois
    // de recarregar a aba, porque o guard já injetado ficava com o valor velho.
    for (const view of crmViews.values()) targets.push([CRM_SURFACE_ID, view]);

    // Em paralelo e com prazo: uma aba travada (renderer que não responde) deixava
    // a tela de Notificações esperando para sempre pelo salvamento.
    await Promise.allSettled(
      targets.map(([serviceId, view]) => {
        if (view.webContents.isDestroyed()) return Promise.resolve();
        const script = notificationSettingsPatchScript(JSON.stringify(guardSettingsFor(serviceId)));
        return Promise.race([
          view.webContents.executeJavaScript(script, true),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      }),
    );
  };

  /** "Limpar" também tira os toasts da Central de Notificações do Windows. */
  const closeOsNotifications = (): void => {
    for (const [serviceId, view] of serviceViews) {
      const svc = appState.services.find((s) => s.id === serviceId);
      if (svc?.kind !== "whatsapp" && svc?.kind !== "gmail") continue;
      void view.webContents
        .executeJavaScript(CLOSE_OS_NOTIFICATIONS_SCRIPT, true)
        .catch(() => undefined);
    }
  };

  let lastPageExternalOpenAt = 0;
  /**
   * A página pediu sozinha (window.open, location=, mailto:), sem clique do
   * usuário no menu. Script de aba no fundo, ou com a janela sem foco, não abre
   * nada fora dela; e uma página em laço abre no máximo um a cada 1,5 s.
   */
  const pageMayOpen = (source: WebContents, url: string): boolean => {
    const front =
      source === activeServiceView()?.webContents ||
      (activeSurface === "crm" && source === crmViews.get(workspaceId)?.webContents);
    const now = Date.now();
    if (!win.isFocused() || !front || now - lastPageExternalOpenAt < 1500) {
      pushLog("info", "abertura externa ignorada", {
        url: url.slice(0, 120),
        motivo: !win.isFocused() ? "janela sem foco" : !front ? "aba no fundo" : "repetida",
      });
      return false;
    }
    lastPageExternalOpenAt = now;
    return true;
  };

  /**
   * Mostra a aba `serviceId` já na `url`: a primeira carga (aba nova ou
   * hibernada) usa a URL pendente; aba carregada navega. Devolve false se a aba
   * não pôde ser mostrada (login do CRM pendente, workspace errado).
   */
  const openUrlInService = (serviceId: string, url: string): boolean => {
    // Workspace ainda sem login do CRM conferido (Meet/Teams de outro workspace):
    // o portão de showSurface o leria como deslogado e o link se perdia.
    const targetWorkspace = appState.services.find((s) => s.id === serviceId)?.workspaceId;
    if (targetWorkspace && !crmLoginKnown.has(targetWorkspace)) {
      void crmSessionHasLogin(targetWorkspace)
        .catch(() => false)
        .then((loggedIn) => {
          if (loggedIn) crmAuthenticatedWorkspaces.add(targetWorkspace);
          crmLoginKnown.add(targetWorkspace);
          if (!openUrlInService(serviceId, url)) void openInPreferredBrowser(url, preferredBrowser());
        });
      return true;
    }
    const surface: Surface = `service:${serviceId}`;
    pendingServiceUrls.set(serviceId, { url, at: Date.now() });
    showSurface(surface, true);
    if (activeSurface !== surface) {
      pendingServiceUrls.delete(serviceId);
      return false;
    }
    if (!pendingServiceUrls.has(serviceId) || needsInitialLoad.has(serviceId)) return true;
    pendingServiceUrls.delete(serviceId);
    const view = serviceViews.get(serviceId);
    if (view && !view.webContents.isDestroyed()) void view.webContents.loadURL(url).catch(() => undefined);
    return true;
  };

  const workspaceHasMeet = (): boolean =>
    appState.services.some((s) => s.kind === "meet" && s.workspaceId === workspaceId && !s.deletedAt);

  /**
   * Link do Meet (convite no Calendar, no Gmail, no WhatsApp, no CRM) abre na aba
   * do Meet do workspace, que já tem a conta Google — no navegador externo a
   * pessoa caía na tela de login. Já numa reunião, pergunta antes de trocar.
   * Sem aba do Meet no workspace, devolve false e o link segue para fora.
   */
  const openInMeetService = (url: string): boolean => {
    if (!isMeetUrl(url)) return false;
    // O do workspace atual primeiro; senão o de outro workspace ativo (o
    // showSurface troca de workspace). Antes, lembrete com o Meet em outro
    // workspace abria no navegador, deslogado.
    const active = new Set(listActiveWorkspaces(appState).map((w) => w.id));
    const candidates = appState.services.filter(
      (s) => s.kind === "meet" && active.has(s.workspaceId) && !s.deletedAt,
    );
    const meetService = candidates.find((s) => s.workspaceId === workspaceId) ?? candidates[0];
    if (!meetService) return false;
    const current = serviceViews.get(meetService.id)?.webContents;
    const currentUrl = current && !current.isDestroyed() ? current.getURL() : "";
    if (meetRoom(currentUrl) && meetRoom(currentUrl) === meetRoom(url)) {
      showSurface(`service:${meetService.id}`, true);
      return true;
    }
    if (meet.inCall(current)) {
      void dialog
        .showMessageBox(win, {
          type: "question",
          buttons: ["Continuar na reunião atual", "Sair e entrar na outra", "Abrir no navegador"],
          defaultId: 0,
          cancelId: 0,
          title: "Google Meet",
          message: "Você está numa reunião no Meet.",
          detail: "Entrar na outra reunião encerra a sua participação nesta.",
        })
        .then(({ response }) => {
          if (response === 1) openUrlInService(meetService.id, url);
          else if (response === 2) void openInPreferredBrowser(url, preferredBrowser());
        });
      return true;
    }
    return openUrlInService(meetService.id, url);
  };

  /**
   * Link de reunião do Teams (convite no Outlook, Gmail, Agenda, WhatsApp) abre
   * no Teams do workspace, já logado — no navegador externo a pessoa entrava
   * deslogada. Com o Teams tocando (provável chamada), pergunta antes: carregar
   * o link ali encerraria a chamada. Sem Teams, devolve false e segue para fora.
   */
  const openInTeamsService = (url: string): boolean => {
    if (!isTeamsMeetingUrl(url)) return false;
    const active = new Set(listActiveWorkspaces(appState).map((w) => w.id));
    const candidates = appState.services.filter(
      (s) => s.kind === "teams" && active.has(s.workspaceId) && !s.deletedAt,
    );
    const teams = candidates.find((s) => s.workspaceId === workspaceId) ?? candidates[0];
    if (!teams) return false;
    const current = serviceViews.get(teams.id)?.webContents;
    if (current && !current.isDestroyed() && current.isCurrentlyAudible()) {
      void dialog
        .showMessageBox(win, {
          type: "question",
          buttons: ["Continuar na chamada atual", "Sair e entrar na outra", "Abrir no navegador"],
          defaultId: 0,
          cancelId: 0,
          title: "Microsoft Teams",
          message: "O Teams parece estar numa chamada.",
          detail: "Entrar na outra reunião encerra a sua participação nesta.",
        })
        .then(({ response }) => {
          if (response === 1) openUrlInService(teams.id, url);
          else if (response === 2) void openInPreferredBrowser(url, preferredBrowser());
        });
      return true;
    }
    return openUrlInService(teams.id, url);
  };

  /** `source` ausente = menu de contexto: aí foi o usuário. */
  const openExternalServiceUrl = (url: string, source?: WebContents): void => {
    if (source && !pageMayOpen(source, url)) return;
    // Só o que a PÁGINA abriu; "abrir no navegador" do menu (sem source) é
    // escolha explícita de ir para fora.
    if (source && (openInMeetService(url) || openInTeamsService(teamsMeetingTarget(url) ?? ""))) return;
    // mailto vai para o programa de e-mail do sistema, mesmo com links da web indo para Brave/Chrome.
    const preferred = /^mailto:/i.test(url) ? "auto" : preferredBrowser();
    void openInPreferredBrowser(url, preferred).then((result) => {
      if (!result.ok) showToast(result.message || "Não foi possível abrir o link");
      else if (isChromeWebStoreUrl(url)) {
        // Sem o aviso, o clique na loja "não fazia nada" no app (ver isChromeWebStoreUrl).
        showToast(`A Chrome Web Store abriu no ${externalBrowserLabel()}: o ADR Browser não instala extensões.`);
      }
    });
  };

  /** "Continuar com o Google" nos serviços de login próprio: ver google-auth-window.ts. */
  const googleAuth = createGoogleAuthBridge({
    parentWindow: win,
    viewMeta: opts.viewMeta,
    isFrontView: (contents) => contents === activeServiceView()?.webContents,
    googleAccounts: (wsId) =>
      listGoogleProfilesForWorkspace(appState, wsId).map((profile) => ({
        id: profile.id,
        name: profile.name,
        partitionName: profile.partitionName,
      })),
    microsoftAccounts: (wsId) =>
      listMicrosoftProfilesForWorkspace(appState, wsId).map((profile) => ({
        id: profile.id,
        name: profile.name,
        partitionName: profile.partitionName,
        // Sem e-mail para mostrar: os serviços da conta ("Outlook · Teams 2") a identificam.
        detail: appState.services
          .filter((s) => s.workspaceId === wsId && !s.deletedAt && s.profileId === profile.id)
          .map((s) => s.name)
          .join(" · "),
      })),
    ensureSessionPolicy: (ses, partitionName, oauthUrl) => {
      // Partição Google sem nenhuma aba criada nesta execução ainda não tem
      // política de permissões: sem ela o Electron concede quase tudo.
      if (!permissions.isAttached(ses)) {
        attachPermissionHandler(ses, partitionName, "browser", "", () => oauthUrl);
      }
    },
    openExternal: (url) => openExternalServiceUrl(url),
    log: (message, extra) => pushLog("info", message, extra),
    addGoogleAccount: (wsId) => addGoogleAccountViaGmail(wsId),
    onLoginRejected: (kind, returnHost) => explainGoogleRejection(kind, returnHost),
  });

  /**
   * "Outra conta…" da escolha de conta Google: a conta nova entra pelo Gmail do
   * workspace (login direto, que o Google aceita aqui) e passa a aparecer na
   * lista. Uma partição nova e vazia cairia na mesma recusa que o app resolveu.
   */
  function addGoogleAccountViaGmail(wsId: string): void {
    const googleServices = appState.services.filter(
      (s) => s.workspaceId === wsId && !s.deletedAt && usesSharedGoogleSession(s.kind),
    );
    const target = googleServices.find((s) => s.kind === "gmail") ?? googleServices[0];
    if (!target) {
      showToast("Adicione o Gmail ao workspace para entrar com outra conta Google.");
      return;
    }
    const url = "https://accounts.google.com/AddSession?continue=https%3A%2F%2Fmail.google.com%2Fmail%2F";
    if (openUrlInService(target.id, url)) {
      showToast('Entre com a outra conta aqui; depois volte e clique de novo em "Continuar com o Google".');
    }
  }

  /** Último aviso de login recusado por serviço (o Google pode recusar em laço). */
  const rejectionExplainedAt = new Map<string, number>();
  /**
   * O Google recusou o login ("navegador não compatível"). A página dele não diz
   * o que fazer aqui; o app diz, e oferece abrir o serviço no navegador.
   */
  function explainGoogleRejection(kind: string, returnHost: string): void {
    const now = Date.now();
    if (now - (rejectionExplainedAt.get(kind) ?? 0) < 10 * 60_000) return;
    rejectionExplainedAt.set(kind, now);
    pushLog("info", "google login rejection", { service: kind, event: "explicado" });
    if (win.isDestroyed()) return;
    let home = "";
    try {
      home = serviceUrl(kind as ServiceKind) || "";
    } catch {
      home = "";
    }
    if (!home && returnHost) home = `https://${returnHost}/`;
    void dialog
      .showMessageBox(win, {
        type: "info",
        buttons: ["Entendi", ...(home ? ["Abrir no navegador"] : [])],
        defaultId: 0,
        cancelId: 0,
        title: "Login com Google",
        message: "O Google recusou o login nesta janela.",
        // Na própria aba Google (Gmail, Agenda, Drive…) "entre pelo Gmail" e
        // "entre sem o Google" não fazem sentido: a recusa é do login em si.
        detail: (usesSharedGoogleSession(kind as ServiceKind)
          ? [
              "O Google às vezes recusa o login em janelas de aplicativo. Tente:",
              "1. Entrar de novo digitando o e-mail e a senha da conta.",
              "2. Se continuar recusando, entrar uma vez pelo navegador e voltar aqui depois.",
            ]
          : [
              "Isso costuma acontecer quando a conta ainda não está logada no Gmail do workspace. Tente:",
              "1. Entrar com essa conta no Gmail do workspace e clicar de novo em \"Continuar com o Google\".",
              "2. Entrar no serviço com e-mail e senha, sem o Google.",
              "3. Usar o serviço no navegador.",
            ]
        ).join("\n"),
      })
      .then(({ response }) => {
        if (response === 1 && home) void openInPreferredBrowser(home, preferredBrowser());
      });
  }

  const attachInAppNavigation = (contents: WebContents, kind: ServiceKind): void => {
    contents.setWindowOpenHandler(({ url, disposition: windowDisposition }) => {
      // Cartão e atalhos do painel do CRM (pessoa, negócio, criar empresa): na
      // aba do CRM do app, que tem a sessão — no navegador externo o usuário
      // caía na tela de login.
      if (isCrmUrl(url)) {
        // Qualquer página aberta no app podia levar a aba do CRM, com a sessão do
        // usuário, a qualquer rota dele. Só as telas que o painel linka passam.
        if (isCrmPagePath(url) && pageMayOpen(contents, url)) {
          showSurface("crm");
          openCrmPath(url);
        }
        return { action: "deny" };
      }
      // Convite do Meet aberto como JANELA (window.open com tamanho) viraria uma
      // janela solta, sem compartilhamento de tela e que morre junto com a aba
      // que a abriu: vai para a aba do Meet, como os links comuns.
      if (kind !== "meet" && isMeetUrl(unwrapRedirectUrl(url)) && workspaceHasMeet()) {
        if (pageMayOpen(contents, url)) openInMeetService(unwrapRedirectUrl(url));
        return { action: "deny" };
      }
      // O mesmo para reunião do Teams, quando o workspace tem Teams.
      const teamsMeeting = kind === "teams" ? null : teamsMeetingTarget(url);
      if (
        teamsMeeting &&
        appState.services.some((s) => s.kind === "teams" && s.workspaceId === workspaceId && !s.deletedAt)
      ) {
        if (pageMayOpen(contents, url)) openInTeamsService(teamsMeeting);
        return { action: "deny" };
      }
      const disposition = servicePopupDisposition(kind, url, windowDisposition, contents.getURL());
      // ADR Browser: link "em nova aba" (target=_blank, clique do meio,
      // Ctrl+clique) abre aba nova ao lado, como no Chrome — antes trocava a
      // página da aba atual. Clique do meio/Ctrl+clique deixa a aba no fundo.
      if (
        hasTabStrip(kind) &&
        disposition === "in-app" &&
        (windowDisposition === "foreground-tab" || windowDisposition === "background-tab")
      ) {
        const opener = opts.viewMeta.get(contents)?.serviceId;
        // "background-tab" só nasce de clique de verdade (meio/Ctrl): vale abrir
        // vários seguidos. "foreground-tab" a página também gera sozinha
        // (window.open sem tamanho), então passa pelo limite de sempre.
        const allowed =
          windowDisposition === "background-tab"
            ? win.isFocused() && contents === activeServiceView()?.webContents
            : pageMayOpen(contents, url);
        if (opener && allowed) {
          // Vários links seguidos da mesma aba entram em sequência depois dela
          // ([aba][1][2][3]), não cada um colado nela ([aba][3][2][1]).
          const chain = linkTabChain;
          const afterId =
            chain?.opener === opener && browserTabServices().some((s) => s.id === chain.last)
              ? chain.last
              : opener;
          const foreground = windowDisposition === "foreground-tab";
          const created = openUrlInBrowserTab(url, afterId, foreground);
          linkTabChain = created && !foreground ? { opener, last: created.id } : null;
        }
        return { action: "deny" };
      }
      if (disposition === "external") {
        openExternalServiceUrl(unwrapRedirectUrl(url), contents);
      } else if (disposition === "in-app") {
        void contents.loadURL(url).catch(() => undefined);
      } else if (disposition === "popup") {
        // Só a aba da frente, com a janela em foco, abre janela — e uma por vez
        // a cada 1,5 s. Sem isto qualquer página (ADR Browser, link aberto na
        // aba) abria quantas janelas sem barra de endereço quisesse.
        if (!pageMayOpen(contents, url)) return { action: "deny" };
        // Janela de verdade, filha da janela do app e na mesma sessão da aba:
        // o login devolve o resultado por window.opener e o window.close() do
        // fim do fluxo fecha esta janela, não a aba do serviço. Sem tamanho fixo:
        // o Chromium aplica o width/height que a página pediu.
        return {
          action: "allow",
          overrideBrowserWindowOptions: { parent: win, autoHideMenuBar: true },
        };
      }
      return { action: "deny" };
    });
    contents.on("did-create-window", (child, details) => {
      child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      // Sem barra de endereço: o título mostra de que site é a página, para que
      // um "login" falso não se passe pelo do serviço.
      const titleWithHost = (): void => {
        if (child.isDestroyed()) return;
        let host = "";
        try {
          host = new URL(child.webContents.getURL()).host;
        } catch {
          /* about:blank */
        }
        const title = child.webContents.getTitle();
        child.setTitle(host ? `${title && title !== host ? `${title} — ` : ""}${host}` : title);
      };
      child.on("page-title-updated", (event) => {
        event.preventDefault();
        titleWithHost();
      });
      child.webContents.on("did-navigate", titleWithHost);
      // Sem a aba que o abriu (hibernou, foi recriada ou excluída) o login não
      // tem para onde devolver o resultado e trava: fecha junto.
      const closeChild = (): void => {
        if (!child.isDestroyed()) child.close();
      };
      contents.once("destroyed", closeChild);
      child.once("closed", () => contents.removeListener("destroyed", closeChild));
      if (!usesStandaloneLogin(kind)) return;
      // Login Google em popup (Notion e afins): o popup fica escondido enquanto a
      // conta é escolhida na janela da sessão Google, e recebe o retorno — é ele
      // que tem o window.opener que o serviço espera. Cancelar fecha o popup.
      // A navegação inicial pode chegar aqui duas vezes (did-create-window e
      // will-navigate): abrir a segunda janela fecharia a primeira e o popup.
      // Só o COMEÇO do OAuth é desviado: o retorno (e o redirecionamento que o
      // serviço faz depois dele) tem de seguir no popup. A mesma URL chegando de
      // novo (did-create-window e will-navigate) não abre outra janela; uma URL
      // nova — clicou de novo num popup reaproveitado — reinicia o login.
      let bridgingUrl = "";
      const bridge = (url: string): boolean => {
        // Google (redirect ou popup GIS do TikTok) e Microsoft: ver oauthStart.
        const flow = oauthStart(url);
        if (!flow) return false;
        if (bridgingUrl === url) return true;
        const hooks = {
          onCancel: () => {
            bridgingUrl = "";
            closeChild();
          },
          onDelivered: () => {
            bridgingUrl = "";
            if (!child.isDestroyed()) child.show();
          },
        };
        const started = googleAuth.signIn(contents, child.webContents, url, flow, hooks);
        if (started && !child.isDestroyed()) child.hide();
        if (started) bridgingUrl = url;
        return started;
      };
      // window.open direto para o Google: a navegação inicial não passa por
      // will-navigate. Parar antes de o documento do Google entrar mantém o opener.
      if (bridge(details.url)) child.webContents.stop();
      const intercept = (event: { url: string; isMainFrame: boolean; preventDefault: () => void }) => {
        if (event.isMainFrame && bridge(event.url)) event.preventDefault();
      };
      child.webContents.on("will-navigate", intercept);
      child.webContents.on("will-redirect", intercept);
    });
    if (usesStandaloneLogin(kind)) {
      const interceptGoogleOAuth = (details: {
        url: string;
        isMainFrame: boolean;
        preventDefault: () => void;
      }): void => {
        if (!details.isMainFrame) return;
        // GIS só existe em popup: sem opener, a aba não teria a quem entregar.
        const flow = oauthStart(details.url);
        const started =
          flow &&
          flow.mode !== "gis" &&
          googleAuth.signIn(contents, contents, details.url, flow, {
            // A navegação para o Google foi cancelada: sem recarregar, o botão
            // "Continuar com o Google" do serviço ficava girando para sempre.
            onCancel: () => {
              if (!contents.isDestroyed()) contents.reload();
            },
          });
        if (!started) {
          return;
        }
        details.preventDefault();
      };
      contents.on("will-navigate", interceptGoogleOAuth);
      contents.on("will-redirect", interceptGoogleOAuth);
    }
    contents.on("will-navigate", (event, url) => {
      if (/^mailto:/i.test(url) || shouldOpenServiceUrlExternally(kind, url)) {
        event.preventDefault();
        openExternalServiceUrl(url, contents);
        return;
      }
    });
    // Redirecionamento do servidor (chrome.google.com/webstore → loja nova) não
    // passa pelo will-navigate e carregaria a loja, que derruba o app.
    contents.on("will-redirect", (event, url) => {
      if (!isChromeWebStoreUrl(url)) return;
      event.preventDefault();
      openExternalServiceUrl(url, contents);
    });
  };

  /**
   * Abrir protocolo externo nunca é lembrado: o "sim" gravado por origem valia
   * para QUALQUER protocolo depois (search-ms:, ms-msdt:…), sem perguntar de
   * novo. Grants antigos de openExternal no estado também deixam de valer aqui.
   */
  const NEVER_REMEMBERED = new Set(["openExternal"]);

  /** `undefined` = nunca respondida; `true` = já autorizada por este usuário. */
  function rememberedPermission(origin: string, permission: string): boolean | undefined {
    if (NEVER_REMEMBERED.has(permission)) return undefined;
    const key = permissionGrantKey(origin, permission);
    return key ? appState.settings.permissionGrants[key] : undefined;
  }

  /**
   * Só o SIM é gravado.
   *
   * Lembrar o NÃO seria simétrico e estaria errado: um clique errado em "Negar"
   * viraria microfone morto para sempre, sem nenhuma tela no app para desfazer —
   * o mesmo beco sem saída que o cartão do Google já custou aqui. Negar continua
   * valendo uma vez; quem quer negar de novo nega de novo, e isso é raro por
   * construção (a pergunta só aparece em serviço que o usuário escolheu abrir).
   */
  function rememberPermission(origin: string, permission: string): void {
    if (NEVER_REMEMBERED.has(permission)) return;
    const key = permissionGrantKey(origin, permission);
    if (!key) return;
    appState = parseAppState({
      ...appState,
      settings: {
        ...appState.settings,
        permissionGrants: { ...appState.settings.permissionGrants, [key]: true },
      },
    });
    saveAppStateAtomic(statePath, appState);
    pushLog("info", "permission lembrada", { origin, permission });
  }

  /** Partição de um serviço — a mesma conta de createServiceView. */
  function servicePartition(svc: ServiceInstance): string {
    return appState.profiles.find((p) => p.id === svc.profileId)?.partitionName || `persist:wa-${svc.id}`;
  }

  /**
   * Serviço da `partition` cuja página inicial é desta origem; senão o ADR
   * Browser da mesma sessão (site qualquer). Hasteada pelo mesmo motivo abaixo.
   */
  /**
   * Casa do serviço: a do kind (serviceUrl), menos o Outlook, que guarda onde a
   * conta mora (pessoal em outlook.live.com, empresa em outlook.office.com).
   */
  function serviceHome(svc: ServiceInstance): string {
    const current = appState.services.find((s) => s.id === svc.id) ?? svc;
    return current.kind === "outlook" && outlookHomeFor(current.startUrl)
      ? current.startUrl
      : serviceUrl(current.kind);
  }

  /** O Outlook chegou à caixa de entrada noutra casa: a próxima abertura já vai direto. */
  function rememberOutlookHome(serviceId: string, url: string): void {
    const home = outlookHomeFor(url);
    const current = appState.services.find((s) => s.id === serviceId);
    if (!home || !current || current.startUrl === home) return;
    appState = parseAppState({
      ...appState,
      services: appState.services.map((s) => (s.id === serviceId ? { ...s, startUrl: home } : s)),
    });
    saveAppStateAtomic(statePath, appState);
  }

  function serviceOfOrigin(partition: string, origin: string): ServiceInstance | undefined {
    const inSession = appState.services.filter((s) => !s.deletedAt && servicePartition(s) === partition);
    return (
      inSession.find((s) => originOf(serviceHome(s)) === originOf(origin)) ||
      inSession.find((s) => s.kind === "browser")
    );
  }

  // Function declaration (hasteada): a primeira view do CRM é criada bem antes
  // desta linha, no topo de createWorkspaceWindow.
  /** A URL é do site do próprio serviço (não de uma página aberta dentro dele)? */
  function isServiceOwnSite(kind: string, url: string): boolean {
    let home = "";
    try {
      home = serviceUrl(kind as ServiceKind);
    } catch {
      return false;
    }
    return isOwnSite(kind, url, home);
  }


  /** Política de permissões de cada sessão: ver permission-handler.ts. */
  const permissions = createPermissionHandler({
    parentWindow: win,
    viewMeta: opts.viewMeta,
    isCrmUrl,
    crmSurfaceId: CRM_SURFACE_ID,
    notificationSettings: () => notifSettings(),
    isServiceOwnSite,
    pageMayOpen: (contents, url) => pageMayOpen(contents, url),
    rememberedPermission,
    rememberPermission,
    serviceOfOrigin,
    meetingQuietFor,
    log: (message, extra) => pushLog("info", message, extra),
  });
  const attachPermissionHandler = permissions.attach;

  /** "Apresentar agora" (getDisplayMedia): ver screen-share.ts. */
  const attachScreenShare = createScreenShare({
    parentWindow: win,
    viewMeta: opts.viewMeta,
    isFrontView: (contents) => contents === activeServiceView()?.webContents,
    log: (level, message, extra) => pushLog(level, message, extra),
  });

  // A faixa "o Spotify não autoriza reprodução aqui, abra no navegador" saiu.
  // O 403 do clienttoken.spotify.com que a motivou era do pacote SEM assinatura
  // VMP: o electron-builder renomeia electron.exe e a assinatura de fábrica da
  // CastLabs para de casar (ver scripts/vmp-sign.cjs). Com o hook de assinatura
  // no lugar, o app instalado toca. Em `pnpm dev` não há VMP e o 403 continua —
  // é limitação do ambiente de desenvolvimento, não recado para o usuário.
  // A saída externa segue no menu de contexto do serviço, como opção.

  const createServiceView = (svc: ServiceInstance): WebContentsView => {
    // `svc` é o objeto da criação; renomear não recria a view. Texto para o
    // usuário lê o nome atual.
    const currentName = (): string => appState.services.find((s) => s.id === svc.id)?.name || svc.name;
    const partitionName = servicePartition(svc);
    assertSafePartitionName(partitionName);
    const ses = session.fromPartition(partitionName);
    const sessionUa = configureSessionUserAgent(svc.kind, ses);
    downloads.attachSession(ses, {
      askDestination: (contents) => opts.viewMeta.get(contents as WebContents)?.kind === "browser",
    });
    adBlocker.attach(ses);
    configureSpellChecker(ses);
    // Separa "o cookie sumiu do disco" de "o cookie está lá e o Spotify recusa",
    // que é a dúvida quando a sessão não sobrevive ao fechamento. Só nome e
    // expiração — valor de cookie de login nunca entra no diagnóstico.
    if (svc.kind === "spotify") {
      void ses.cookies
        .get({ domain: "spotify.com" })
        .then((cookies) =>
          pushLog("info", "spotify cookies", {
            total: cookies.length,
            persistentes: cookies.filter((c) => c.expirationDate).length,
            nomes: cookies
              .map((c) => c.name)
              .slice(0, 20)
              .join(","),
          }),
        )
        .catch(() => undefined);
      // Medido: os cookies anônimos do Spotify (sp_t, sp_landing, OptanonConsent)
      // chegam ao disco, e sp_dc/sp_key nunca. Isso descarta flush e partição — a
      // pergunta que sobra é se o Spotify chega a definir o cookie de login, e
      // quem o tira. `changed` responde as duas: `cause` diz se saiu por
      // sobrescrita, expiração ou remoção explícita, e `session` diz se ele veio
      // sem validade (cookie de sessão NUNCA é gravado em disco, por definição).
      //
      // Filtro fechado por nome: esta partição tem 350 cookies, a maioria de
      // domínio de anúncio. Valor de cookie nunca entra no log.
      if (!loggedSpotifyCookies.has(ses)) {
        loggedSpotifyCookies.add(ses);
        ses.cookies.on("changed", (_event, cookie, cause, removed) => {
          if (!/(^|\.)spotify\.com$/i.test(cookie.domain || "")) return;
          if (!["sp_dc", "sp_key", "sp_adid"].includes(cookie.name)) return;
          pushLog("info", "spotify login cookie", {
            nome: cookie.name,
            removido: removed,
            causa: cause,
            sessao: cookie.session,
            expiraEm: cookie.expirationDate
              ? new Date(cookie.expirationDate * 1000).toISOString()
              : null,
          });
          // Medido em 17/08: o Spotify EMITE sp_dc/sp_key (`causa: explicit`), só
          // que sem validade — `sessao: true`, `expiraEm: null`. Cookie de sessão
          // nunca é gravado em disco, por definição do Chromium: não há o que
          // flushStore grave, e o login morre junto com o processo. Era essa a
          // ponta que faltava do "Spotify pede login toda vez".
          //
          // Regravar com validade é o que o "Lembrar de mim" da tela de login
          // faria — mesma sessão, mesma máquina, mesma partição. As condições e o
          // guarda de recursão estão em spotify-cookie.ts, com teste.
          if (shouldPersistSpotifyCookie(cookie, removed)) {
            const host = (cookie.domain || "").replace(/^\./, "");
            // Campo a campo em vez de tudo no literal: com exactOptionalPropertyTypes
            // um `domain: undefined` explícito não é o mesmo que ausente, e copiar
            // atributo por atributo mantém o cookie idêntico — só a validade muda.
            const details: Electron.CookiesSetDetails = {
              url: `https://${host}${cookie.path || "/"}`,
              name: cookie.name,
              value: cookie.value,
              sameSite: cookie.sameSite,
              expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
            };
            if (cookie.domain) details.domain = cookie.domain;
            if (cookie.path) details.path = cookie.path;
            if (cookie.secure !== undefined) details.secure = cookie.secure;
            if (cookie.httpOnly !== undefined) details.httpOnly = cookie.httpOnly;
            void ses.cookies
              .set(details)
              .then(() => ses.cookies.flushStore())
              .then(() => pushLog("info", "spotify cookie com validade", cookie.name))
              .catch((error) =>
                pushLog("error", "spotify cookie persist", {
                  nome: cookie.name,
                  erro: String(error),
                }),
              );
          }
        });
      }
    }
    attachPermissionHandler(ses, partitionName, svc.kind, svc.id, () => serviceHome(svc));
    // Contador de Outlook/Teams: vem pela Badging API (microsoft-badge-preload),
    // registrada uma vez na sessão da conta Microsoft, que é só deles.
    if (usesSharedMicrosoftSession(svc.kind) && !ses.getPreloadScripts().some((p) => p.id === "adr-microsoft-badge")) {
      ses.registerPreloadScript({
        id: "adr-microsoft-badge",
        type: "frame",
        filePath: path.join(opts.dirname, "../preload/microsoft-badge-preload.cjs"),
      });
    }
    attachScreenShare(ses);
    // Resposta 4xx/5xx em XHR morre calada dentro da view — foi um 403 assim
    // (clienttoken do Spotify) que travou a reprodução sem nenhuma mensagem.
    // Só XHR/fetch, para não encher o log com imagem e fonte quebrada.
    if (!loggedSessions.has(ses)) {
      loggedSessions.add(ses);
      const httpLogUntil = Date.now() + 5 * 60 * 1000;
      // Passada a janela, tira o ouvinte: senão toda requisição da sessão seguia
      // cruzando para o main só para ser descartada.
      setTimeout(() => ses.webRequest.onCompleted(null), 5 * 60 * 1000).unref?.();
      ses.webRequest.onCompleted((details) => {
        if (Date.now() > httpLogUntil) return;
        if (details.statusCode < 400) return;
        if (details.resourceType !== "xhr" && details.resourceType !== "other") return;
        pushLog("info", "http", { status: details.statusCode, url: details.url.slice(0, 120) });
      });
    }

    const view = new WebContentsView({
      webPreferences: {
        partition: partitionName,
        ...(svc.kind === "gmail"
          ? { preload: path.join(opts.dirname, "../preload/gmail-preload.cjs") }
          : svc.kind === "whatsapp" && viewKindAllowsCrmPreload("whatsapp")
          ? { preload: path.join(opts.dirname, "../preload/crm-preload.cjs") }
          : viewKindAllowsComposerPreload(svc.kind)
            ? { preload: path.join(opts.dirname, "../preload/composer-preload.cjs") }
            : { preload: path.join(opts.dirname, "../preload/form-activity-preload.cjs") }),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    if (sessionUa) view.webContents.setUserAgent(sessionUa);
    // Com "Electron" no User-Agent o Spotify entrega o player de celular
    // (mobile-web-player, `fallback=getapp`), que não toca faixas: medido em
    // 06/10. Só a aba: a sessão é a Google compartilhada, que fica com a
    // identidade nativa de que o login do Google depende.
    else if (svc.kind === "spotify") view.webContents.setUserAgent(whatsappUserAgent(ses.getUserAgent()));
    view.setBackgroundColor("#0b141b");
    opts.viewMeta.set(view.webContents, {
      kind: svc.kind,
      workspaceId: svc.workspaceId,
      serviceId: svc.id,
    });
    if (mutedBrowserTabs.has(svc.id)) view.webContents.setAudioMuted(true);
    attachZoom(view.webContents);
    attachInAppNavigation(view.webContents, svc.kind);
    attachContextMenu(
      view.webContents,
      (url) => openExternalServiceUrl(url),
      hasTabStrip(svc.kind)
        ? {
            openInNewTab: (url) => openUrlInBrowserTab(url, svc.id, true),
            print: () => printPage(view),
          }
        : undefined,
    );
    view.webContents.setBackgroundThrottling(true);
    // Ctrl+roda do mouse: o mesmo zoom por site do Ctrl+= / Ctrl+-.
    view.webContents.on("zoom-changed", (_e, direction) => {
      if (hasTabStrip(svc.kind)) stepPageZoom(view, direction === "in" ? 1 : -1);
    });
    view.webContents.on("did-navigate", (_e, url) => {
      // Depois do attachZoom (que volta ao zoom da interface): o do site por cima.
      applyPageZoom(view.webContents);
      // Página nova: o ícone e a busca eram da anterior.
      browserFavicons.delete(svc.id);
      if (findTargetId === view.webContents.id) stopFind(true);
      if (svc.kind === "browser") {
        suspendedBrowserUrls.set(svc.id, browserRestoreUrl(svc.startUrl, url));
        recordBrowserVisit(svc.id, url, view.webContents.getTitle());
      }
      if (svc.kind === "outlook") rememberOutlookHome(svc.id, url);
      if (svc.kind === "whatsapp" && !isWhatsAppAppUrl(url)) {
        // O próprio WhatsApp (ou um portal de rede/proxy) pode mandar para fora
        // sempre: sem teto, era recarregar e abrir aba externa em laço.
        const now = Date.now();
        const recent = (whatsappBounces.get(svc.id) ?? []).filter((at) => now - at < 60_000);
        recent.push(now);
        whatsappBounces.set(svc.id, recent);
        if (recent.length > 3) {
          pushLog("error", "whatsapp saiu do site repetidamente", { service: svc.id });
          if (recent.length === 4) {
            showToast(`${currentName()} está sendo redirecionado para fora. Verifique a conexão e recarregue.`);
          }
          return;
        }
        if (isAllowedExternalUrl(url)) openExternalServiceUrl(url, view.webContents);
        void view.webContents.loadURL(WHATSAPP_URL);
        return;
      }
      syncBrowserChrome(svc);
      if (usesSharedGoogleSession(svc.kind) && isGoogleLoginRejectionUrl(url)) {
        // Mantém a página do Google e as ações de recuperação. Nunca loga query,
        // fragmento, texto da página nem cookies: URL de login traz dado da conta.
        pushLog("info", "google login rejection", { service: svc.kind, event: "navigation" });
        // Na aba do próprio Google (Gmail, Agenda…), orientar também.
        if (serviceViews.get(svc.id) === view && activeSurface === `service:${svc.id}`) {
          explainGoogleRejection(svc.kind, "");
        }
      }
    });
    view.webContents.on("did-navigate-in-page", (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      if (svc.kind === "browser") {
        suspendedBrowserUrls.set(svc.id, browserRestoreUrl(svc.startUrl, url));
        // SPA (YouTube, Gmail aberto na aba…) troca de página sem recarregar.
        recordBrowserVisit(svc.id, url, view.webContents.getTitle());
      }
      syncBrowserChrome(svc);
      if (usesSharedGoogleSession(svc.kind) && isGoogleLoginRejectionUrl(url)) {
        pushLog("info", "google login rejection", { service: svc.kind, event: "in-page" });
      }
    });
    view.webContents.on("did-finish-load", () => {
      serviceLoadRetries.delete(svc.id);
      failedServiceIds.delete(svc.id);
      if (svc.kind === "whatsapp") void injectWhatsAppGuards(view, svc.id);
      if (svc.kind === "gmail") {
        // O Gmail só emite notificação nativa se o usuário ligar nas opções
        // dele; quando liga, esta injeção faz valer a chave de notificações do
        // app e o clique passar a focar a aba certa em vez de não fazer nada.
        void injectNotificationGuard(view, svc.id).catch(() => undefined);
        const url = view.webContents.getURL();
        if (
          /^https:\/\/(www\.)?google\.com\/intl\//.test(url) ||
          /mail\.google\.com\/mail\/u\/0\/#$/.test(url)
        ) {
          // Conta sem Gmail volta para /intl/ sempre: sem teto, era recarga em laço
          // (o mesmo teto de 3 por minuto do WhatsApp).
          const now = Date.now();
          const recent = (whatsappBounces.get(svc.id) ?? []).filter((at) => now - at < 60_000);
          recent.push(now);
          whatsappBounces.set(svc.id, recent);
          if (recent.length <= 3) void view.webContents.loadURL("https://mail.google.com/mail/u/0/#inbox");
        }
      }
      // Do not scan arbitrary service content for authentication error text.
      // An email or search result can quote that text during a healthy session.
      syncBrowserChrome(svc);
      kickResize(view.webContents);
    });
    view.webContents.on("did-fail-load", (_e, code, desc, url, isMain) => {
      if (!isMain || code === -3) return;
      if (serviceViews.get(svc.id) !== view) return;
      console.error("service did-fail-load", svc.id, code, desc, url);
      loadingServiceIds.delete(svc.id);
      failedServiceIds.add(svc.id);
      broadcastState();
      const retries = (serviceLoadRetries.get(svc.id) || 0) + 1;
      serviceLoadRetries.set(svc.id, retries);
      clearTimeout(serviceRetryTimers.get(svc.id));
      if (retries <= 3) {
        serviceRetryTimers.set(
          svc.id,
          setTimeout(() => {
            serviceRetryTimers.delete(svc.id);
            if (serviceViews.get(svc.id) !== view || view.webContents.isDestroyed()) return;
            if (!failedServiceIds.has(svc.id)) return;
            // reload() não faz nada quando a primeira carga falhou antes de
            // confirmar: não há entrada para recarregar.
            // Com algo já carregado, reload() (reenvia um POST de login como
            // POST); sem nada, carregar a URL que falhou.
            if (!view.webContents.getURL() && /^https?:/i.test(url)) {
              void view.webContents.loadURL(url).catch(() => undefined);
            } else view.webContents.reload();
          }, 1500 * retries),
        );
      } else {
        showToast(`Não foi possível carregar ${currentName()}. Tente novamente em Serviços.`);
      }
    });
    view.webContents.on("did-start-loading", () => {
      failedServiceIds.delete(svc.id);
      pushBrowserLoading(view);
      if (hasTabStrip(svc.kind)) pushBrowserTabs();
      if (loadingServiceIds.has(svc.id)) return;
      loadingServiceIds.add(svc.id);
      broadcastState();
    });
    view.webContents.on("did-stop-loading", () => {
      pushBrowserLoading(view);
      if (hasTabStrip(svc.kind)) pushBrowserTabs();
      if (!loadingServiceIds.delete(svc.id)) return;
      broadcastState();
    });
    view.webContents.on("page-favicon-updated", (_e, favicons) => {
      const icon = pickFavicon(favicons);
      browserFavicons.set(svc.id, icon);
      if (activeServiceView() === view) browserToolbar?.webContents.send("browser:favicon", icon);
      if (hasTabStrip(svc.kind)) pushBrowserTabs();
    });
    view.webContents.on("found-in-page", (_e, result) => {
      if (findTargetId !== view.webContents.id) return;
      browserToolbar?.webContents.send("browser:find-result", {
        active: result.activeMatchOrdinal,
        total: result.matches,
      });
    });
    view.webContents.on("enter-html-full-screen", () => {
      if (serviceViews.get(svc.id) !== view) return;
      htmlFullscreenServiceId = svc.id;
      // O Electron pode já ter posto a janela em tela cheia sozinho; aí não é
      // nossa para desfazer.
      if (!win.isFullScreen()) {
        windowFullscreenByPage = true;
        win.setFullScreen(true);
      }
      layout();
    });
    view.webContents.on("leave-html-full-screen", () => {
      if (htmlFullscreenServiceId === svc.id) endPageFullscreen();
    });
    view.webContents.on("page-title-updated", (_e, title) => {
      if (hasTabStrip(svc.kind)) {
        if (title) browserTitles.set(svc.id, title);
        pushBrowserTabs();
        // O título chega depois da navegação: completa a visita e a aba salva.
        const url = view.webContents.getURL();
        browserHistory.title(url, title);
        browserHistory.setTab(svc.id, { url, title });
      }
      if (svc.kind === "whatsapp" || svc.kind === "gmail") {
        const raw = title || view.webContents.getTitle();
        applyUnread(svc.kind === "gmail" ? unreadFromGmailTitle(raw) : unreadFromWhatsAppTitle(raw));
      }
      syncBrowserChrome(svc);
    });
    // Outlook e Teams: o número chega pela Badging API (microsoft-badge-preload),
    // só do documento principal desta view.
    if (usesSharedMicrosoftSession(svc.kind)) {
      view.webContents.ipc.on("service:app-badge", (event, count: unknown) => {
        if (event.senderFrame !== view.webContents.mainFrame) return;
        const n = Number(count);
        if (Number.isFinite(n)) applyUnread(Math.min(9999, Math.max(0, Math.trunc(n))));
      });
    }
    // Outlook: setAppBadge nunca vem numa aba comum; o preload manda os títulos
    // das pastas e a caixa de entrada diz as não lidas.
    if (svc.kind === "outlook") {
      view.webContents.ipc.on("service:folder-titles", (event, titles: unknown) => {
        if (event.senderFrame !== view.webContents.mainFrame || !Array.isArray(titles)) return;
        for (const title of titles.slice(0, 40)) {
          const unread = unreadFromOutlookFolderTitle(String(title).slice(0, 200));
          if (unread !== null) return applyUnread(unread);
        }
      });
    }
    /** Não lidas novas deste serviço (`null`: a fonte não sabe dizer agora). */
    function applyUnread(unread: number | null): void {
      const isMail = svc.kind === "gmail";
      const prev = badgeUnread.get(svc.id) || 0;
      // null: título sem contador conhecido (Gmail fora da caixa de entrada).
      if (unread !== null && unread !== prev) {
        const cleared = appState.settings.clearedUnread[svc.id];
        const nextCleared = nextClearedUnread(cleared, prev, unread, unreadDrops.get(svc.id));
        if (nextCleared !== cleared) setClearedUnread(svc.id, nextCleared);
        // Sem `trayDismissed = false` aqui de propósito: quem rearma o
        // contador é o usuário abrir o serviço (ver showSurface), não a
        // chegada de mensagem. Ver o comentário em trayDismissed.
        if (unread > 0) badgeUnread.set(svc.id, unread);
        else {
          badgeUnread.delete(svc.id);
          unreadDrops.set(svc.id, { count: prev, at: Date.now() });
        }
        refreshTrayBadge();
        // Mensagem não entra no sino: lá ficam só avisos do app (atualização,
        // aba recuperada, configuração). Mensagem já tem a bolinha da barra
        // lateral, o contador da barra de tarefas e a notificação do próprio
        // serviço — no sino, cada mensagem nova depois de "Limpar" fazia a
        // lista "voltar". O WhatsApp mostra a nativa dele (passa pelo nosso
        // guard); o Gmail só mostra se o usuário ligar nas opções do Gmail,
        // então para ele fica o aviso rápido na tela.
        const blip = prev === 0 && unread > 0 && isUnreadReloadBlip(unreadDrops.get(svc.id), unread);
        if (prev === 0 && unread > 0) {
          pushLog("info", "não lidas 0→N", { service: currentName(), unread, recarga: blip });
        }
        if (
          isMail &&
          prev === 0 &&
          unread > 0 &&
          !blip &&
          shouldAllowServiceNotification(notifSettings(), svc.id)
        ) {
          const plural = unread > 1 ? "s" : "";
          showToast(`${unread} e-mail${plural} não lido${plural} em ${currentName()}`);
        }
        broadcastState();
      }
    }
    // Diagnóstico do play: se nunca ficar audible, o problema é decodificar/soltar
    // o áudio; se ficar audible e mesmo assim não sair som, é saída do Windows.
    view.webContents.on("audio-state-changed", (event) => {
      pushLog("info", "audio-state", { service: svc.name, audible: event.audible });
      lastAudibleAt = Date.now();
      // Tocar é usar. Sem isto, a ociosidade de uma aba tocando no fundo contava
      // desde o último CLIQUE nela: o YouTube aberto às 13:32, tocando até 13:57
      // com o usuário no WhatsApp, era hibernado 7 s depois de o vídeo acabar
      // (diagnóstico de 01/10) — sem prazo nenhum para dar play no próximo. O
      // carimbo na parada dá o prazo inteiro (10 min, ou 3/1 sob pressão) a partir
      // do fim do som, e o do início põe a aba no fim da fila do LRU.
      if (serviceViews.get(svc.id) === view) lastUsedAt.set(svc.id, Date.now());
      // O som costuma COMEÇAR com a aba já no fundo — faixa seguinte da playlist,
      // play pelo teclado, autoplay do YouTube. Sem reavaliar aqui, ela seguiria
      // estrangulada até a próxima troca de aba, que é quando o usuário não está.
      applyBackgroundThrottle(view, activeSurface === `service:${svc.id}`);
      // Alto-falante na aba da faixa.
      if (hasTabStrip(svc.kind)) pushBrowserTabs();
    });
    if (svc.kind === "whatsapp" || viewKindAllowsComposerPreload(svc.kind)) view.webContents.on("console-message", ({ message }) => {
      const text = String(message || "");
      if (svc.kind === "gmail" && text.startsWith("ADR_GMAIL_PANEL:")) {
        pushLog(text === "ADR_GMAIL_PANEL:mounted" ? "info" : "error", "gmail-panel", {
          serviceId: svc.id,
          state: text.slice("ADR_GMAIL_PANEL:".length, 80),
        });
      }
      // Tradutor de campo que não montou (Trusted Types etc.) sumia sem rastro.
      // Só log: qualquer página pode imprimir isto, e aqui não decide nada.
      if (text.startsWith("ADR_COMPOSER_TRANSLATOR:")) {
        pushLog("error", "composer-translator", {
          service: svc.kind,
          state: text.slice("ADR_COMPOSER_TRANSLATOR:".length, 80),
        });
      }
      // Só o guard de notificação (WhatsApp/Gmail) emite isto, e só para o próprio
      // id: qualquer página aberta no ADR Browser poderia dar console.log e roubar
      // o foco.
      if (
        svc.kind === "whatsapp" &&
        isWhatsAppAppUrl(view.webContents.getURL()) &&
        text.startsWith("ADR_OPEN_WHATSAPP_CHAT:")
      ) {
        try {
          const payload: unknown = JSON.parse(text.slice("ADR_OPEN_WHATSAPP_CHAT:".length));
          if (!payload || typeof payload !== "object") return;
          const chat = payload as { serviceId?: unknown; title?: unknown };
          if (chat.serviceId !== svc.id || typeof chat.title !== "string" || chat.title.length > 512) return;
          pendingNotificationChats.set(svc.id, chat.title);
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
          showSurface(`service:${svc.id}`, true);
        } catch {
          // Mensagem inválida da página não muda a sessão nem abre outra conta.
        }
      }
      if (
        (svc.kind === "whatsapp" || svc.kind === "gmail") &&
        text.startsWith("ADR_FOCUS_SERVICE:")
      ) {
        const id = text.slice("ADR_FOCUS_SERVICE:".length).trim();
        if (id === svc.id) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
          showSurface(`service:${id}`);
        }
      }
    });

    const life = new ViewLifecycle();
    life.transition("loading");
    life.transition("active");
    recovery.register({
      id: svc.id,
      kind: svc.kind,
      lifecycle: life,
      recreate: () => {
        recovery.unregister(svc.id);
        const current = serviceViews.get(svc.id);
        if (current) {
          rememberBrowserNavigation(svc.id, current.webContents);
          try {
            win.contentView.removeChildView(current);
            closeView(current);
          } catch {
            // already gone
          }
          serviceViews.delete(svc.id);
        }
        needsInitialLoad.delete(svc.id);
        // A view morta não emite did-stop-loading: sem isto o spinner do rail
        // ficava girando até o usuário abrir a aba recriada.
        loadingServiceIds.delete(svc.id);
        const fresh = appState.services.find((s) => s.id === svc.id);
        if (!fresh || fresh.deletedAt) return;
        const recreated = createServiceView(fresh);
        if (activeSurface === `service:${svc.id}`) {
          layout();
        } else {
          place(recreated, HIDDEN);
        }
        notify(`Aba recuperada: ${fresh.name}`, { surface: `service:${fresh.id}` });
        pushLog("info", "view recreated after crash", svc.id);
      },
    });
    view.webContents.on("render-process-gone", (_event, details) => {
      console.error("service render-process-gone", svc.id, details);
      // Saída do app ou renderer encerrado normalmente não é travamento: recriar
      // aqui montaria uma aba numa janela que está sumindo (erro no fechamento).
      if (appQuitting || win.isDestroyed() || details.reason === "clean-exit") return;
      // A chamada daquela aba acabou (fora do fechamento do app: lá não importa).
      meet.forget(svc.id);
      if (serviceViews.get(svc.id) !== view) return;
      const now = Date.now();
      const recent = (serviceCrashTimes.get(svc.id) || []).filter((time) => now - time < 60_000);
      recent.push(now);
      serviceCrashTimes.set(svc.id, recent);
      if (recent.length >= 3) {
        recovery.unregister(svc.id);
        try {
          win.contentView.removeChildView(view);
          closeView(view);
        } catch {
          // The crashed renderer may already have destroyed its contents.
        }
        serviceViews.delete(svc.id);
        needsInitialLoad.delete(svc.id);
        loadingServiceIds.delete(svc.id);
        failedServiceIds.add(svc.id);
        pushLog("error", "service recovery limit", { service: svc.id, reason: details.reason });
        showToast(`${currentName()} falhou repetidamente. Tente novamente em Serviços.`);
        if (activeSurface === `service:${svc.id}`) showSurface("settings");
        else broadcastState();
        return;
      }
      recovery.handleRenderProcessGone(svc.id);
    });
    view.webContents.on("destroyed", () => {
      if (appQuitting || windowClosing || closingViews.has(view) || serviceViews.get(svc.id) !== view) {
        return;
      }
      dropDeadServiceView(svc.id, view);
      // A página que se fechou (fim de login, "pode fechar esta aba") voltaria na
      // recriação e chamaria window.close() de novo: laço criar/carregar/fechar.
      // O ADR Browser volta à página inicial dele; os outros já voltam à home.
      if (svc.kind === "browser") suspendedBrowserUrls.set(svc.id, svc.startUrl);
      const now = Date.now();
      const closedRecently = now - (selfClosedAt.get(svc.id) ?? 0) < 15_000;
      selfClosedAt.set(svc.id, now);
      if (closedRecently) {
        showToast(`${currentName()} fechou sozinho. Abra de novo pela barra lateral.`);
        if (activeSurface === `service:${svc.id}`) showSurface("settings");
        else broadcastState();
        return;
      }
      // Recria a aba ativa fora deste evento, não dentro do destroy da anterior.
      setImmediate(() => {
        if (!win.isDestroyed()) layout();
      });
    });

    // Primeira navegação só quando a view tem tamanho de verdade (evita Agenda em branco e QR do WhatsApp girando).
    needsInitialLoad.add(svc.id);
    win.contentView.addChildView(view);
    serviceViews.set(svc.id, view);
    hibernatedServiceIds.delete(svc.id);
    failedServiceIds.delete(svc.id);
    attachKeys(view.webContents);
    return view;
  };

  // Sob demanda: a view do serviço só nasce quando o usuário o abre (grande economia com WhatsApp e YouTube).
  function ensureServiceView(svc: ServiceInstance): WebContentsView {
    const existing = serviceViews.get(svc.id);
    // O webContents some sem aviso quando a própria página fecha a aba
    // (window.close()); usar a view morta derrubava o processo main
    // ("reading 'setZoomFactor'"). Todo caminho de layout passa por aqui.
    if (existing?.webContents && !existing.webContents.isDestroyed()) {
      applyPageZoom(existing.webContents);
      return existing;
    }
    if (existing) dropDeadServiceView(svc.id, existing);
    return createServiceView(svc);
  }

  /** Estado que some junto com a view — hibernar e aba morta usam o mesmo. */
  function forgetServiceView(id: string): void {
    serviceViews.delete(id);
    needsInitialLoad.delete(id);
    loadingServiceIds.delete(id);
    failedServiceIds.delete(id);
    serviceLoadRetries.delete(id);
    clearTimeout(serviceRetryTimers.get(id));
    serviceRetryTimers.delete(id);
    serviceCrashTimes.delete(id);
    hibernatedServiceIds.add(id);
    lastUsedAt.delete(id);
    releaseUnusedBrowserToolbar();
  }

  /**
   * Aba cujo webContents morreu sem o app fechá-la — a página chamou
   * window.close() ou o renderer sumiu. Sai do mapa na hora: qualquer layout ou
   * loop sobre serviceViews antes disso tocaria um webContents morto.
   */
  function dropDeadServiceView(id: string, view: WebContentsView): void {
    recovery.unregister(id);
    if (!win.isDestroyed()) win.contentView.removeChildView(view);
    forgetServiceView(id);
    pushLog("error", "service webContents destruido", { service: id });
  }

  /**
   * Ninguém está olhando para o app — nem para a aba da frente.
   *
   * É o que autoriza hibernar a superfície ativa. Ela é, quase sempre, o maior
   * renderer do processo (WhatsApp com anos de histórico, ou o CRM), e era a
   * única que nunca era liberada: o LRU e a pressão de RAM param nela, e o
   * carimbo de "usada agora" em `enforceHibernation` a rejuvenescia a cada
   * minuto. Minimizar e sair para almoçar deixava esses 400–700 MB residentes.
   *
   * `isDestroyed` primeiro: as três chamadas abaixo lançam em janela morta.
   */
  function nobodyWatching(): boolean {
    if (win.isDestroyed() || win.isMinimized() || !win.isVisible()) return true;
    // Windows bloqueado (almoço, noite) com o app maximizado também é ninguém olhando.
    try {
      return powerMonitor.getSystemIdleState(60) === "locked";
    } catch {
      return false;
    }
  }

  function hibernateServiceView(
    id: string,
    cause: {
      reason: "idle" | "lru" | "optimizer" | "manual" | "removed";
      pressure?: MemoryPressure;
    },
  ): void {
    const view = serviceViews.get(id);
    if (!view) return;
    if (activeSurface === `service:${id}` && !nobodyWatching()) return;
    rememberBrowserNavigation(id, view.webContents);
    // O porquê vai junto: só o id não distinguia ociosidade, LRU sob pressão ou
    // clique do usuário, e o diagnóstico do YouTube de 01/10 ficou sem resposta.
    const svc = appState.services.find((s) => s.id === id);
    const last = lastUsedAt.get(id);
    pushLog("info", "hibernate view", {
      id,
      service: svc?.name,
      ...cause,
      keepAwake: Boolean(svc?.keepAwake),
      idleMin: last ? Math.round((Date.now() - last) / 60_000) : null,
    });
    recovery.unregister(id);
    // Grava o cookie ANTES de a view sumir. Hibernar é o caminho mais rodado do
    // app (a cada 10 min de inatividade); só o before-quit e o session-end
    // gravavam, então login renovado durante o dia podia nunca chegar ao disco.
    // A sessão é da partição e sobrevive ao close, então o flush pode terminar
    // depois — não vale segurar a hibernação por I/O.
    const hibernatingSession = view.webContents.session;
    void hibernatingSession.cookies.flushStore().catch(() => undefined);
    win.contentView.removeChildView(view);
    closeView(view);
    forgetServiceView(id);
    closeConnectionsIfUnused(hibernatingSession);
    broadcastState();
  }

  /**
   * RAM do app inteiro — main, GPU, utilitários e todo renderer —, que é o
   * número que o usuário vê no gerenciador de tarefas e o que ele chama de "o
   * app está comendo RAM". `workingSetSize` vem em KB (mesma fonte do export de
   * diagnóstico, para os dois contarem a mesma coisa).
   */
  function appMemoryBytes(): number {
    try {
      return app
        .getAppMetrics()
        .reduce((total, metric) => total + (metric.memory?.workingSetSize || 0) * 1024, 0);
    } catch {
      // Sem medida, política de sempre: apertar por chute custa reload de aba.
      return 0;
    }
  }

  /** Mensageiro com "Manter em memória": só cede em pressão crítica de RAM. */
  function messengerStaysAwake(svc: ServiceInstance | undefined, pressure: MemoryPressure): boolean {
    return messengerKindStaysAwake(svc?.kind, Boolean(svc?.keepAwake), pressure);
  }

  /** Ociosidade, LRU e pressão de RAM: ver hibernation.ts. */
  const hibernation = createHibernationController({
    windowGone: () => win.isDestroyed(),
    nobodyWatching,
    appMemoryBytes,
    totalMemory: () => os.totalmem(),
    maxLoadedViewsSetting: () => appState.settings.maxLoadedViews,
    downloadsInProgress: () => downloads.list().some((download) => download.state === "progressing"),
    log: (message, extra) => pushLog("info", message, extra),
    serviceIds: () => [...serviceViews.keys()],
    serviceContents: (id) => serviceViews.get(id)?.webContents,
    serviceInfo: (id) => {
      const svc = appState.services.find((s) => s.id === id);
      // Mensageiro em memória passa por messengerStaysAwake, que cede em pressão crítica.
      return svc ? { kind: svc.kind, keepAwake: Boolean(svc.keepAwake) && !isMessengerKind(svc.kind), hibernateAfterMinutes: svc.hibernateAfterMinutes } : undefined;
    },
    messengerStaysAwake: (id, pressure) =>
      messengerStaysAwake(appState.services.find((s) => s.id === id), pressure),
    lastUsedAt,
    activeServiceId: () => (activeSurface.startsWith("service:") ? activeSurface.slice("service:".length) : null),
    serviceBusy: async (id) => {
      const contents = serviceViews.get(id)?.webContents;
      if (!contents) return true;
      // Login Google na aba, ou na janela da conta: hibernar fecharia no meio.
      if (isGoogleAccountsUrl(contents.getURL()) || googleAuth.isOpenFor(contents)) return true;
      if (appState.services.find((s) => s.id === id)?.kind === "teams") return teamsInCall(contents);
      // Sala do Meet: hibernar derrubaria a pessoa da reunião (vale com a
      // câmera ligada e todo mundo em silêncio).
      return isMeetCallUrl(contents.getURL()) && (await meet.probe(contents));
    },
    hibernateService: (id, cause) => hibernateServiceView(id, cause),
    crmIds: () => [...crmViews.keys()],
    crmContents: (id) => crmViews.get(id)?.webContents,
    crmReady: async (id) => crmAuthenticatedWorkspaces.has(id) && (await crmSessionHasLogin(id)),
    crmSurfaceActive: () => activeSurface === "crm",
    crmActiveFor: (id) => activeSurface === "crm" && workspaceId === id,
    crmLastUsedAt: () => crmLastUsedAt,
    touchCrm: (at) => {
      crmLastUsedAt = at;
    },
    closeCrm: (id) => closeCrmView(id),
  });
  function canHibernate(id: string, pressure: MemoryPressure): Promise<boolean> {
    return hibernation.canHibernate(id, pressure);
  }
  function canHibernateCrm(id: string): Promise<boolean> {
    return hibernation.canHibernateCrm(id);
  }
  function enforceHibernation(): Promise<void> {
    return hibernation.enforce();
  }

  const hibernationTimer = setInterval(() => {
    void enforceHibernation();
  }, 60_000);

  /** DevTools aberto antes do bloqueio continuava mostrando o DOM das conversas. */
  function closeServiceDevTools(serviceId: string): void {
    const contents = serviceViews.get(serviceId)?.webContents;
    if (contents && !contents.isDestroyed()) contents.closeDevTools();
  }

  // A atividade do PIN tem o próprio timer curto; a hibernação nunca o renova.
  function refreshWhatsAppPrivacy(): boolean {
    if (win.isDestroyed()) return false;
    const now = Date.now();
    let changed = false;
    let activeLocked = false;
    for (const id of whatsappUnlocked) {
      if (!isWhatsAppLocked(id)) continue;
      if (!whatsappLockExpired(whatsappLastActive.get(id) || 0, lockTimeoutMs(id), now)) continue;
      whatsappUnlocked.delete(id);
      closeServiceDevTools(id);
      whatsappLastActive.delete(id);
      changed = true;
      if (activeSurface === `service:${id}`) {
        activeSurface = "settings";
        activeLocked = true;
        showToast(`WhatsApp bloqueado por inatividade (${lockTimeoutMinutes(id)} min).`);
      }
    }
    // Expira primeiro: uma entrada que chega depois de muito tempo parado/suspenso não desbloqueia.
    if (activeSurface.startsWith("service:") && win.isFocused() && !nobodyWatching()) {
      const id = activeSurface.slice("service:".length);
      if (whatsappUnlocked.has(id)) {
        try {
          whatsappLastActive.set(
            id,
            latestWhatsAppActivity(
              whatsappLastActive.get(id) || 0,
              now,
              powerMonitor.getSystemIdleTime(),
              true,
            ),
          );
        } catch {
          /* No activity evidence: retain the previous timestamp. */
        }
      }
    }
    if (changed) broadcastState();
    return activeLocked;
  }
  const privacyTimer = setInterval(() => {
    if (refreshWhatsAppPrivacy()) layout();
  }, 1000);

  const syncServiceViews = (): void => {
    const wantedIds = new Set(
      appState.services
        .filter(
          (s) =>
            // Todo ServiceKind tem view própria. A lista fixa anterior esquecia
            // "instagram": a view era fechada no primeiro sync (adicionar serviço,
            // duplicar, trocar de workspace), inclusive se estivesse aberta.
            !s.deletedAt && listActiveWorkspaces(appState).some((w) => w.id === s.workspaceId),
        )
        .map((s) => s.id),
    );
    for (const [id, view] of serviceViews) {
      if (!wantedIds.has(id)) {
        suspendedBrowserUrls.delete(id);
        suspendedBrowserHistory.delete(id);
        const ses = view.webContents.session;
        win.contentView.removeChildView(view);
        closeView(view);
        // Mesma limpeza da hibernação: spinner/falha do rail, nova tentativa
        // agendada e registro de crash não podem sobreviver à view fechada.
        recovery.unregister(id);
        forgetServiceView(id);
        closeConnectionsIfUnused(ses);
      }
    }
    // Do not eagerly create every service — wait until showSurface/layout.
  };

  syncServiceViews();

  if (browserToolbar) win.contentView.addChildView(browserToolbar);
  win.contentView.addChildView(shellView, 0);
  win.contentView.addChildView(panel);
  // Minimizado, o Windows devolve content bounds 0×0 (medido: -32000,-32000,0×0)
  // e AINDA dispara `resize`: sem a guarda o layout inteiro roda com largura 0,
  // põe todas as views em 0×0 e as esconde, só para desfazer tudo no restore.
  win.on("resize", () => {
    if (!win.isMinimized()) layout();
  });
  // Agora a aba da frente TAMBÉM hiberna com a janela escondida, então restaurar
  // precisa recriá-la. `resize` não serve de gatilho: restaurar uma janela
  // maximizada volta ao mesmo tamanho e pode não disparar resize nenhum — daria
  // uma área vazia no lugar da aba. `layout` recria a view e `ensureServiceLoaded`
  // renavega (createServiceView repõe `needsInitialLoad`).
  win.on("restore", () => layout());

  const openPalette = (): void => {
    paletteOpen = true;
    layoutOverlay();
    overlay.webContents.focus();
    overlay.webContents.send("shell:palette");
  };

  /**
   * DevTools da superfície da frente.
   *
   * Não existia atalho nenhum para isto, em nenhuma view — e é o que faltou para
   * fechar a "tela preta" do CRM: sem console, um erro de JS que aborta a
   * montagem da página é indistinguível de um problema de layout do app. Nada no
   * processo main vê a diferença.
   *
   * Destacado: a view não tem largura sobrando para o painel encaixado, e a do
   * CRM é justamente a que costuma estar estreita.
   */
  function activeSurfaceContents(): WebContents | undefined {
    const contents =
      activeSurface === "crm"
        ? crmViews.get(workspaceId)?.webContents
        : activeSurface.startsWith("service:")
          ? activeServiceView()?.webContents
          : panel.webContents;
    return contents && !contents.isDestroyed() ? contents : undefined;
  }

  const openActiveDevTools = (): void => {
    const contents = activeSurfaceContents();
    if (!contents) return;
    if (contents.isDevToolsOpened()) contents.closeDevTools();
    else contents.openDevTools({ mode: "detach" });
  };

  /** Ctrl+K devolvido à página (campo de texto): a próxima passada deixa passar. */
  let passCtrlKOnce = false;
  function onKey(event: { preventDefault: () => void }, input: Input): void {
    if (input.type !== "keyDown") return;
    if (input.key === "F12") {
      event.preventDefault();
      openActiveDevTools();
      return;
    }
    // Alt+←/→ em QUALQUER superfície, inclusive a do CRM. A barra de navegação
    // aparece sozinha quando o serviço sai do site dele, mas o atalho vale
    // também onde ela não aparece — e é o gesto que todo mundo já tem no dedo.
    if (input.alt && (input.key === "ArrowLeft" || input.key === "ArrowRight")) {
      const contents = activeSurfaceContents();
      if (!contents) return;
      event.preventDefault();
      const history = contents.navigationHistory;
      if (input.key === "ArrowLeft") {
        if (history.canGoBack()) history.goBack();
      } else if (history.canGoForward()) history.goForward();
      return;
    }
    // F5 recarrega; Ctrl+F5/Shift+F5 sem cache — os mesmos do Ctrl+R/Ctrl+Shift+R.
    if (input.key === "F5") {
      event.preventDefault();
      reloadActiveSurface(Boolean(input.control || input.shift));
      return;
    }
    const chromeView = (): WebContentsView | undefined => {
      const svc = activeService();
      return svc && serviceUsesBrowserShortcuts(svc) ? activeServiceView() : undefined;
    };
    // F6 e Alt+D vão para a barra de endereço, como o Ctrl+L.
    if (
      (input.key === "F6" && !input.control && !input.alt) ||
      (input.alt && !input.control && !input.meta && (input.key === "d" || input.key === "D"))
    ) {
      if (!chromeView()) return;
      event.preventDefault();
      focusAddressBar();
      return;
    }
    // F3 / Shift+F3: próximo/anterior da busca (abre a busca se estiver fechada).
    if (input.key === "F3" && !input.control && !input.alt) {
      const view = chromeView();
      if (!view || pageOwnsFindAndPrint(view.webContents.getURL())) return;
      event.preventDefault();
      stepFind(view, !input.shift);
      return;
    }
    if (!(input.control || input.meta)) return;
    if (input.shift && (input.key === "I" || input.key === "i")) {
      event.preventDefault();
      openActiveDevTools();
      return;
    }
    if (input.key === "r" || input.key === "R") {
      event.preventDefault();
      reloadActiveSurface(Boolean(input.shift));
      return;
    }
    if (input.key === "l" || input.key === "L") {
      const svc = activeService();
      if (svc && serviceUsesBrowserShortcuts(svc)) {
        event.preventDefault();
        focusAddressBar();
      }
      return;
    }
    // Atalhos de aba, como no Chrome. Ctrl+T vale em qualquer superfície (abre
    // uma aba do ADR Browser); Ctrl+W e Ctrl+Tab só com uma aba dele na frente
    // — fechar o WhatsApp com Ctrl+W seria um acidente.
    // Sem Alt: Ctrl+Alt é o AltGr do teclado ABNT2.
    if (input.key === "Tab" && !input.alt) {
      const svc = activeService();
      if (!svc || !hasTabStrip(svc.kind)) return;
      event.preventDefault();
      cycleBrowserTab(input.shift ? -1 : 1);
      return;
    }
    // Ctrl+PageDown/PageUp: o outro par de atalhos de aba do Chrome.
    if ((input.key === "PageDown" || input.key === "PageUp") && !input.alt && !input.shift) {
      const svc = activeService();
      if (!svc || !hasTabStrip(svc.kind)) return;
      event.preventDefault();
      cycleBrowserTab(input.key === "PageDown" ? 1 : -1);
      return;
    }
    // Ctrl+Shift+K duplica a aba (Edge). Antes do Ctrl+K da paleta.
    // Fora do Browser segue para a paleta, como antes.
    if (input.shift && !input.alt && (input.key === "k" || input.key === "K")) {
      const svc = activeService();
      if (svc && hasTabStrip(svc.kind)) {
        event.preventDefault();
        duplicateBrowserTab(svc.id);
        return;
      }
    }
    // Ctrl+H: histórico do ADR Browser.
    if (!input.shift && !input.alt && (input.key === "h" || input.key === "H")) {
      // No Google Docs, Ctrl+H é "localizar e substituir" (como o Ctrl+F lá).
      const view = chromeView();
      if (!view || pageOwnsFindAndPrint(view.webContents.getURL())) return;
      event.preventDefault();
      openHistoryWindow();
      return;
    }
    // Ctrl+D: favorita (ou tira dos favoritos) a página, como a estrela.
    if (!input.shift && !input.alt && (input.key === "d" || input.key === "D")) {
      if (!chromeView()) return;
      event.preventDefault();
      browserToolbar?.webContents.send("browser:toggle-bookmark");
      return;
    }
    // Ctrl+G / Ctrl+Shift+G: próximo/anterior da busca, como o F3.
    if (!input.alt && (input.key === "g" || input.key === "G")) {
      const view = chromeView();
      if (!view || pageOwnsFindAndPrint(view.webContents.getURL())) return;
      event.preventDefault();
      stepFind(view, !input.shift);
      return;
    }
    // Zoom da página: Ctrl+= (ou Ctrl++) e Ctrl+-. O Ctrl+0 do Chrome aqui é o
    // atalho do CRM; volta a 100% clicando no indicador da barra.
    if (!input.alt && (input.key === "=" || input.key === "+" || input.key === "-")) {
      const svc = activeService();
      const view = svc && hasTabStrip(svc.kind) ? activeServiceView() : undefined;
      if (!view) return;
      event.preventDefault();
      stepPageZoom(view, input.key === "-" ? -1 : 1);
      return;
    }
    if (!input.shift && !input.alt && (input.key === "t" || input.key === "T")) {
      event.preventDefault();
      openNewBrowserTab();
      return;
    }
    if (!input.shift && !input.alt && (input.key === "w" || input.key === "W")) {
      const svc = activeService();
      if (!svc || !hasTabStrip(svc.kind)) return;
      event.preventDefault();
      closeBrowserTab(svc.id);
      return;
    }
    if (input.key === "k" || input.key === "K") {
      if (passCtrlKOnce) {
        passCtrlKOnce = false;
        return;
      }
      event.preventDefault();
      // Num campo de texto, Ctrl+K é da página ("inserir link" no Gmail, Outlook,
      // Notion): devolve a tecla em vez de abrir a busca do app por cima.
      const contents = activeSurfaceContents();
      if (!contents || !contents.isFocused()) {
        openPalette();
        return;
      }
      void contents
        .executeJavaScript(
          "(() => { const a = document.activeElement; return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); })()",
        )
        .catch(() => false)
        .then((editing) => {
          if (!editing || contents.isDestroyed()) return openPalette();
          passCtrlKOnce = true;
          contents.sendInputEvent({ type: "keyDown", keyCode: "K", modifiers: ["control"] });
          contents.sendInputEvent({ type: "keyUp", keyCode: "K", modifiers: ["control"] });
        });
      return;
    }
    if (input.shift && (input.key === "t" || input.key === "T")) {
      event.preventDefault();
      reopenClosedBrowserTab();
      return;
    }
    if (!input.shift && (input.key === "f" || input.key === "F" || input.key === "p" || input.key === "P")) {
      // Só nos serviços com atalhos de navegador (no Notion, Ctrl+P é a busca
      // dele). Docs/Planilhas têm busca e impressão próprias (ver
      // pageOwnsFindAndPrint).
      const svc = activeService();
      const view = activeServiceView();
      if (!svc || !view || !serviceUsesBrowserShortcuts(svc)) return;
      if (pageOwnsFindAndPrint(view.webContents.getURL())) return;
      event.preventDefault();
      if (input.key === "f" || input.key === "F") openFind(view);
      else printPage(view);
      return;
    }
    if (/^[1-9]$/.test(input.key)) {
      // Só aqui montamos a lista: shellStatePayload() varre workspaces, downloads
      // e lê o registro do Windows (getLoginItemSettings) — caro demais para
      // rodar a cada Ctrl+C/Ctrl+V digitado dentro de um serviço.
      // A mesma lista da lateral (abas do Browser num ícone só): o número
      // bate com a posição que a pessoa vê.
      const services = railServices(workspaceId);
      const target = services[Number(input.key) - 1];
      if (target) {
        event.preventDefault();
        showSurface(`service:${target.id}`);
      }
      return;
    }
    if (input.key === "0") {
      event.preventDefault();
      showSurface("crm");
      return;
    }
    if (input.key === ",") {
      event.preventDefault();
      showSurface("settings");
    }
  }
  function focusAddressBar(): void {
    browserToolbar?.webContents.focus();
    void browserToolbar?.webContents
      .executeJavaScript(
        `document.getElementById('url')?.focus(); document.getElementById('url')?.select();`,
        true,
      )
      .catch(() => undefined);
  }

  function openFind(view: WebContentsView): void {
    if (findTargetId !== null && findTargetId !== view.webContents.id) stopFind(false);
    findTargetId = view.webContents.id;
    browserToolbar?.webContents.focus();
    // Texto selecionado na página vira o termo da busca. Lido num mundo isolado:
    // a página não tem como trocar o getSelection que esta leitura usa. Seleção
    // que vira termo encolhe para o começo dela: a busca parte dali e a
    // ocorrência selecionada é a atual ("1 de 3"), como no Chrome — e ao fechar
    // ela volta selecionada (stopFind com keepSelection). Seleção longa (um
    // parágrafo, não vira termo) fica intacta.
    void view.webContents
      .executeJavaScriptInIsolatedWorld(FIND_SELECTION_WORLD_ID, [
        {
          code: `(() => { const s = window.getSelection(); const t = String(s || ''); const seed = t.replace(/\\s+/g, ' ').trim(); if (seed && seed.length <= ${FIND_SEED_MAX_CHARS} && s.rangeCount) s.collapseToStart(); return t; })()`,
        },
      ])
      .then((selection: unknown) => findSeedFromSelection(String(selection ?? "")))
      .catch(() => "")
      .then((seed) => browserToolbar?.webContents.send("browser:find-open", seed));
  }

  /** F3/Ctrl+G: anda na busca aberta; com ela fechada, abre. */
  function stepFind(view: WebContentsView, forward: boolean): void {
    if (findTargetId !== view.webContents.id) {
      openFind(view);
      return;
    }
    browserToolbar?.webContents.send("browser:find-step", forward);
  }

  function printPage(view: WebContentsView): void {
    view.webContents.print({}, (success, failureReason) => {
      if (success || failureReason === "cancelled") return;
      pushLog("error", "print", failureReason);
      showToast("Não foi possível imprimir esta página.");
    });
  }

  function reopenClosedBrowserTab(): void {
    const tab = closedBrowserTabs.popFor(workspaceId, (id) =>
      appState.services.some((s) => s.id === id && s.deletedAt),
    );
    if (!tab) {
      showToast("Nenhuma aba do ADR Browser fechada para reabrir.");
      return;
    }
    try {
      appState = restoreDeletedService(appState, tab.serviceId, tab.index < 0 ? undefined : tab.index);
    } catch (error) {
      pushLog("error", "reabrir aba", String(error));
      showToast("Não foi possível reabrir a aba.");
      return;
    }
    saveAppStateAtomic(statePath, appState);
    // A view nasce já na página em que a aba estava (ensureServiceLoaded).
    suspendedBrowserUrls.set(tab.serviceId, tab.url);
    syncServiceViews();
    showSurface(`service:${tab.serviceId}`, true);
  }

  // Function declarations (hasteadas), como attachPermissionHandler e pelo mesmo
  // motivo: a primeira view do CRM nasce no topo de createWorkspaceWindow, muito
  // antes desta linha, e precisa dos atalhos — F12 inclusive.
  function attachKeys(contents: WebContents): void {
    if (keyed.has(contents)) return;
    keyed.add(contents);
    contents.on("before-input-event", onKey);
  }
  const raiseChrome = (): void => {
    if (browserToolbar) win.contentView.addChildView(browserToolbar);
    win.contentView.addChildView(panel);
    win.contentView.addChildView(shellView, 0);
    win.contentView.addChildView(overlay);
    if (promptResolve) win.contentView.addChildView(promptOverlay);
  };
  attachKeys(shellView.webContents);
  attachKeys(panel.webContents);
  attachKeys(overlay.webContents);

  for (const view of crmViews.values()) attachKeys(view.webContents);
  for (const view of serviceViews.values()) attachKeys(view.webContents);
  raiseChrome();

  const parseSurface = (raw: unknown): Surface => {
    const value = String(raw || "");
    if (value === "crm" || value === "settings" || value === "notifications" || value === "empty") {
      return value;
    }
    if (value.startsWith("service:")) return value as Surface;
    if (value === "whatsapp") {
      const first = shellStatePayload().services.find((s) => s.kind === "whatsapp");
      if (first) return `service:${first.id}`;
    }
    return "crm";
  };

  /**
   * Segunda tranca dos canais privilegiados. Hoje só as views do próprio app
   * carregam o preload que os expõe (o do WhatsApp tem lista fechada de
   * comandos) — o registro é global por canal, e este guarda existe para um
   * preload novo, ou um serviço que passe a usar o preload do shell, não virar
   * IPC privilegiado de graça. Confere também a PÁGINA (fromShellPage): a view
   * certa com conteúdo de fora não passa.
   */
  const guardedHandle =
    (allowed: () => Array<{ webContents: WebContents }>) =>
    (channel: string, fn: Parameters<typeof ipcMain.handle>[1]): void => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (event, ...args) => {
        if (!allowed().some((view) => view.webContents === event.sender) || !fromShellPage(event)) {
          return { ok: false, message: "Origem não autorizada" };
        }
        return fn(event, ...args);
      });
    };
  const handleShell = guardedHandle(() => [shellView, panel, overlay]);
  const handlePanel = guardedHandle(() => [panel]);
  const handleToolbar = guardedHandle(() => browserToolbar ? [browserToolbar] : []);
  const handleMiniBar = guardedHandle(() => (miniBar ? [miniBar] : []));
  const handleHistory = guardedHandle(() =>
    historyWindow && !historyWindow.isDestroyed() ? [historyWindow] : [],
  );
  handleHistory("history:search", (_event, query: unknown) =>
    browserHistory.search(typeof query === "string" ? query.slice(0, 200) : "").map((entry) => ({
      url: entry.url,
      title: entry.title,
      lastVisitedAt: entry.lastVisitedAt,
      visitCount: entry.visitCount,
    })),
  );
  handleHistory("history:get-appearance", () => ({
    theme: appState.settings.theme,
    persistent: browserHistory.persistent(),
  }));
  handleHistory("history:remove", (_event, url: unknown) => {
    if (typeof url !== "string") return { ok: false };
    browserHistory.remove(url);
    return { ok: true };
  });
  handleHistory("history:clear", async () => {
    const parent = historyWindow && !historyWindow.isDestroyed() ? historyWindow : win;
    const answer = await dialog.showMessageBox(parent, {
      type: "warning",
      title: "Limpar histórico",
      message: "Apagar todo o histórico do ADR Browser?",
      detail: "As abas abertas continuam onde estão. Esta ação não pode ser desfeita.",
      buttons: ["Limpar histórico", "Cancelar"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (answer.response !== 0) return { ok: false };
    browserHistory.clear();
    return { ok: true };
  });
  // Abrir um item: aba nova do ADR Browser ao lado da aba ativa, com a janela
  // do app na frente. Só endereço que o próprio histórico aceitaria.
  handleHistory("history:open", (_event, url: unknown) => {
    if (typeof url !== "string" || !isRecordableUrl(url)) return { ok: false };
    const active = activeService();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    openUrlInBrowserTab(url, active && hasTabStrip(active.kind) ? active.id : undefined, true);
    return { ok: true };
  });
  handleMiniBar("mini:action", (_event, action: unknown) => {
    const serviceId = miniServiceId;
    if (!serviceId) return { ok: false };
    if (action === "expand") showSurface(`service:${serviceId}`, true);
    else if (action === "hide") meet.hideMiniForCurrentCall(serviceId);
    else return { ok: false };
    return { ok: true };
  });

  const optimizer = createOptimizerController({
    userDataDir: app.getPath("userData"),
    ...(!app.isPackaged
      ? { nativeExecutable: path.join(app.getAppPath(), "optimizer-native", "target", "release", "adr-workspace-optimizer.exe") }
      : {}),
    appProcesses: () => app.getAppMetrics(),
    captureWorkspace: () => {
      const processUses = new Map<number, number>();
      for (const view of [...serviceViews.values(), ...crmViews.values()]) {
        const pid = view.webContents.getOSProcessId();
        if (pid > 0) processUses.set(pid, (processUses.get(pid) || 0) + 1);
      }
      return {
        workspace: workspaceId,
        services: orderedServicesForWorkspace(appState, workspaceId).length,
        loadedViews: serviceViews.size + crmViews.size,
        loadedServices: serviceViews.size,
        sharedRendererProcesses: [...processUses.values()].filter((count) => count > 1).length,
        maxLoadedViews: appState.settings.maxLoadedViews ?? recommendedMaxLoadedViews(os.totalmem()),
        recommendedMaxLoadedViews: recommendedMaxLoadedViews(os.totalmem()),
        idleLoadedServices: [...serviceViews.keys()].filter((id) => {
          // Mensageiro em memória não é sugestão que o otimizador consiga cumprir.
          if (messengerStaysAwake(appState.services.find((s) => s.id === id), "normal")) return false;
          const last = lastUsedAt.get(id);
          return last !== undefined && Date.now() - last >= hibernateAfterMs("normal", false);
        }).length,
      };
    },
    hibernateEligible: async () => {
      let hibernated = 0;
      let skipped = 0;
      const threshold = hibernateAfterMs("normal", false);
      for (const id of [...serviceViews.keys()]) {
        const last = lastUsedAt.get(id);
        const idle = last !== undefined && Date.now() - last >= threshold;
        if (!idle || !(await canHibernate(id, "normal"))) {
          skipped++;
          continue;
        }
        // A aba pode ter ido para a frente enquanto a primeira sonda rodava.
        if (!serviceViews.has(id) || !(await canHibernate(id, "normal"))) {
          skipped++;
          continue;
        }
        hibernateServiceView(id, { reason: "optimizer" });
        hibernated++;
      }
      return { hibernated, skipped };
    },
    setMaxLoadedViews: (count) => {
      if (!Number.isInteger(count) || count < 1 || count > 32) throw new Error("Limite inválido");
      appState = parseAppState({
        ...appState,
        settings: { ...appState.settings, maxLoadedViews: count },
      });
      saveAppStateAtomic(statePath, appState);
      broadcastState();
    },
    onProgress: (event) => {
      if (!win.isDestroyed() && !panel.webContents.isDestroyed())
        panel.webContents.send("shell:optimizer-progress", event);
    },
  });
  handlePanel("shell:optimizer-analyze", () => optimizer.analyze());
  handlePanel("shell:optimizer-snapshot", () => optimizer.getSnapshot());
  handlePanel("shell:optimizer-preview", (_event, ids: unknown) => {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== "string"))
      throw new Error("Seleção inválida");
    return optimizer.preview(ids);
  });
  handlePanel("shell:optimizer-apply", (_event, previewId: unknown, cleanupConfirmed: unknown) => {
    if (typeof previewId !== "string" || previewId.length > 80 || typeof cleanupConfirmed !== "boolean")
      throw new Error("Prévia inválida");
    return optimizer.apply(previewId, cleanupConfirmed);
  });
  handlePanel("shell:optimizer-run", (_event, id: unknown) =>
    typeof id === "string" && id.length <= 80 ? optimizer.getRun(id) : null,
  );
  handlePanel("shell:optimizer-cancel", (_event, id: unknown) =>
    typeof id === "string" && id.length <= 80 ? optimizer.cancel(id) : null,
  );
  handlePanel("shell:optimizer-restore", (_event, runId: unknown, actionId: unknown) => {
    if (typeof runId !== "string" || runId.length > 80 || typeof actionId !== "string" || actionId.length > 250)
      throw new Error("Ação inválida");
    return optimizer.restore(runId, actionId);
  });
  handlePanel("shell:optimizer-history", (_event, offset: unknown = 0) => {
    if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Página de histórico inválida");
    return optimizer.history(offset);
  });
  handlePanel("shell:optimizer-export", () => optimizer.exportReport());
  const windowsSettings = {
    startup: "ms-settings:startupapps",
    storage: "ms-settings:storagerecommendations",
    power: "ms-settings:powersleep",
    apps: "ms-settings:appsfeatures",
    notifications: "ms-settings:notifications",
    graphics: "ms-settings:display-advancedgraphics",
  } as const;
  handlePanel("shell:optimizer-windows-settings", async (_event, section: unknown) => {
    if (process.platform !== "win32" || typeof section !== "string" || !(section in windowsSettings))
      throw new Error("Configuração do Windows indisponível");
    await shell.openExternal(windowsSettings[section as keyof typeof windowsSettings]);
    return { ok: true };
  });

  handleShell(
    "shell:ask-text",
    async (_event, title?: string, initial?: string, okLabel?: string) => {
      return showPrompt(String(title || "Nome"), String(initial || ""), String(okLabel || "OK"));
    },
  );

  // window.confirm dentro de uma WebContentsView trava o renderer do painel e
  // ignora o tema do app — mesmo motivo que levou o prompt para overlay próprio.
  handleShell(
    "shell:confirm",
    async (_event, message?: string, okLabel?: string, detail?: string) => {
      const { response } = await dialog.showMessageBox(win, {
        type: "question",
        title: "Confirmar",
        message: String(message || "Confirmar?"),
        ...(detail ? { detail: String(detail) } : {}),
        buttons: ["Cancelar", String(okLabel || "Confirmar")],
        // Enter não confirma: os pedidos daqui são "Remover", "Sair", "Revogar".
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return { ok: response === 1 };
    },
  );

  ipcMain.removeHandler("shell:prompt-result");
  ipcMain.handle("shell:prompt-result", (event, value: unknown, id: unknown) => {
    if (event.sender !== promptOverlay.webContents || !fromShellPage(event)) return { ok: false };
    if (String(id) !== String(promptId)) return { ok: false };
    const raw = value == null ? "" : String(value);
    const text = value == null ? null : promptIsSecret ? raw || null : raw.trim() || null;
    hidePrompt();
    if (promptResolve) {
      const resolve = promptResolve;
      promptResolve = null;
      promptIsSecret = false;
      resolve(text);
    }
    // Depois do resolve: um prompt encadeado (confirmar PIN) fica com o foco.
    setTimeout(focusActiveSurface, 0);
    return { ok: true };
  });

  handleShell("shell:window", (_event, action: string) => {
    if (action === "minimize") win.minimize();
    else if (action === "maximize") {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === "close") win.close();
    return { ok: true };
  });

  handleShell("shell:open-palette", () => {
    openPalette();
    return { ok: true };
  });

  handleShell("shell:toast-bounds", (event, width?: number, height?: number) => {
    if (event.sender !== overlay.webContents) return { ok: false };
    if (!width || !height) {
      toastVisible = false;
      clearTimeout(toastTimer);
    } else {
      toastSize = { width: Math.ceil(width), height: Math.ceil(height) };
    }
    layoutOverlay();
    return { ok: true };
  });

  handleShell("shell:close-palette", () => {
    paletteOpen = false;
    layoutOverlay();
    // Sem devolver o foco, o teclado ficava na overlay invisível depois do Esc.
    focusActiveSurface();
    return { ok: true };
  });

  handleShell("shell:toggle-notif-panel", () => {
    notifPanelOpen = !notifPanelOpen;
    if (notifPanelOpen) for (const item of notifFeed) item.read = true;
    layoutOverlay();
    overlay.webContents.send("shell:notif-panel", notifPanelOpen);
    if (notifPanelOpen) overlay.webContents.focus();
    else focusActiveSurface();
    broadcastState();
    return { ok: true, open: notifPanelOpen };
  });

  handleShell("shell:clear-notifications", () => {
    pushLog("info", "notificações limpas", { itens: notifFeed.length });
    notifFeed.length = 0;
    trayDismissed = true;
    refreshTrayBadge();
    closeOsNotifications();
    broadcastState();
    return { ok: true };
  });

  handleShell("shell:rename-workspace", (_event, name: string) => {
    appState = renameWorkspace(appState, workspaceId, String(name || "").trim() || "Workspace");
    saveAppStateAtomic(statePath, appState);
    broadcastState();
    return { ok: true, state: shellStatePayload() };
  });

  handleShell("shell:set-autostart", (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
    autostartEnabled = app.getLoginItemSettings().openAtLogin;
    broadcastState();
    return { ok: true, openAtLogin: autostartEnabled };
  });

  handleShell("shell:hibernate-service", (_event, serviceId: string) => {
    const id = String(serviceId || "");
    requireCurrentService(id);
    hibernateServiceView(id, { reason: "manual" });
    return { ok: true, state: shellStatePayload() };
  });

  handleShell("shell:reload", (_event, hard?: boolean) => {
    if (activeSurface.startsWith("service:")) {
      serviceLoadRetries.delete(activeSurface.slice("service:".length));
    }
    reloadActiveSurface(Boolean(hard));
    return { ok: true };
  });

  handleShell("shell:show", (_event, surface: string, panelTab?: string) => {
    const parsed = parseSurface(surface);
    showSurface(parsed, true);
    if (
      parsed === "settings" &&
      panelTab &&
      ["geral", "servicos", "tema", "perfil", "notif", "privacidade", "desempenho"].includes(panelTab)
    ) {
      if (panel.webContents.isLoadingMainFrame()) pendingPanelTab = panelTab;
      else panel.webContents.send("shell:panel-tab", panelTab);
    }
    return { ok: true };
  });

  // Primeiro alinha todas as telas com o estado atual (e o lastBroadcast): sem
  // isso, uma tela recarregada recebia aqui um valor que as outras não tinham
  // visto, e se ele voltasse ao anterior o diff não mandava nada — ela ficava
  // com o valor velho.
  handleShell("shell:get-state", () => {
    broadcastState();
    return shellStatePayload();
  });

  const requireCurrentService = (serviceId: string): ServiceInstance => {
    const service = appState.services.find(
      (item) => item.id === serviceId && item.workspaceId === workspaceId && !item.deletedAt,
    );
    if (!service) throw new Error("serviço inexistente neste workspace");
    return service;
  };

  const renameServiceById = (serviceId: string, name: string): void => {
    const service = requireCurrentService(serviceId);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("nome obrigatório");
    appState =
      service.kind === "whatsapp"
        ? renameWhatsAppInstance(appState, serviceId, trimmed)
        : service.kind === "instagram"
          ? renameInstagramInstance(appState, serviceId, trimmed)
          : parseAppState({
              ...appState,
              services: appState.services.map((item) =>
                item.id === serviceId ? { ...item, name: trimmed } : item,
              ),
            });
    saveAppStateAtomic(statePath, appState);
    broadcastState();
  };

  const duplicateServiceById = (
    serviceId: string,
    opts: { newGoogleAccount?: boolean } = {},
  ): void => {
    requireCurrentService(serviceId);
    const duplicated = duplicateServiceInWorkspace(appState, serviceId, opts);
    appState = duplicated.state;
    saveAppStateAtomic(statePath, appState);
    syncServiceViews();
    showSurface(`service:${duplicated.duplicatedId}`);
  };

  const setServicePinned = (serviceId: string, pinned: boolean): void => {
    requireCurrentService(serviceId);
    appState = parseAppState({
      ...appState,
      services: appState.services.map((service) =>
        service.id === serviceId ? { ...service, pinned } : service,
      ),
    });
    saveAppStateAtomic(statePath, appState);
    broadcastState();
  };

  /**
   * `next`: para onde ir se o removido era a aba ativa. Sem ele, o primeiro
   * serviço da lateral; a faixa de abas passa a vizinha (tabAfterClose).
   */
  const removeServiceById = (serviceId: string, next?: string): void => {
    requireCurrentService(serviceId);
    const removed = appState.services.find((s) => s.id === serviceId && !s.deletedAt);
    if (removed?.kind === "browser") {
      const liveUrl = serviceViews.get(serviceId)?.webContents.getURL();
      closedBrowserTabs.push({
        serviceId,
        workspaceId: removed.workspaceId,
        index:
          appState.workspaces
            .find((w) => w.id === removed.workspaceId)
            ?.serviceInstanceIds.indexOf(serviceId) ?? -1,
        url: browserRestoreUrl(
          removed.startUrl,
          liveUrl && !liveUrl.startsWith("data:") ? liveUrl : suspendedBrowserUrls.get(serviceId),
        ),
      });
    }
    if (findTargetId !== null && serviceViews.get(serviceId)?.webContents.id === findTargetId) stopFind(true);
    browserFavicons.delete(serviceId);
    browserTitles.delete(serviceId);
    mutedBrowserTabs.delete(serviceId);
    // Aba fechada não reabre ao iniciar (o Ctrl+Shift+T guarda o endereço dela).
    browserHistory.setTab(serviceId, null);
    hibernateServiceView(serviceId, { reason: "removed" });
    hibernatedServiceIds.delete(serviceId);
    loadingServiceIds.delete(serviceId);
    failedServiceIds.delete(serviceId);
    serviceLoadRetries.delete(serviceId);
    serviceCrashTimes.delete(serviceId);
    suspendedBrowserUrls.delete(serviceId);
    suspendedBrowserHistory.delete(serviceId);
    // Sem isto o contador do ícone continuava somando os não lidos de um
    // serviço que não existe mais, até o próximo WhatsApp mudar de título.
    badgeUnread.delete(serviceId);
    unreadDrops.delete(serviceId);
    // hibernateServiceView desiste da aba ativa e não chega a limpar estes.
    recovery.unregister(serviceId);
    lastUsedAt.delete(serviceId);
    whatsappUnlocked.delete(serviceId);
    whatsappLastActive.delete(serviceId);
    refreshTrayBadge();
    appState = softDeleteService(appState, serviceId);
    saveAppStateAtomic(statePath, appState);
    // hibernateServiceView desiste quando o serviço é a aba ativa; sem isto a
    // view do serviço removido continuava viva (e consumindo) até o próximo sync.
    syncServiceViews();
    const first = shellStatePayload().services[0];
    if (activeSurface === `service:${serviceId}`) {
      // Sai do excluído ANTES: se o primeiro for um WhatsApp bloqueado e o PIN
      // for cancelado, showSurface não troca nada e a aba ficava no excluído.
      activeSurface = "empty";
      const target = next && appState.services.some((s) => s.id === next && !s.deletedAt) ? next : first?.id;
      showSurface(target ? `service:${target}` : "empty");
    } else if (!first) showSurface("empty");
    else broadcastState();
  };

  /** Adicionar pela lateral e "nova aba" da faixa/Ctrl+T passam por aqui. */
  const addServiceAndShow = (
    kind: ServiceKind,
    name?: string,
    newGoogleAccount?: boolean,
  ): ServiceInstance | undefined => {
    const previousIds = new Set(appState.services.map((service) => service.id));
    appState = addServiceToWorkspace(appState, kind, name, {
      newGoogleAccount: Boolean(newGoogleAccount),
    });
    saveAppStateAtomic(statePath, appState);
    syncServiceViews();
    // O primeiro Gmail/Agenda adiciona os dois. Abre o que o usuário escolheu.
    const created = orderedServicesForWorkspace(appState, workspaceId).find(
      (service) => !previousIds.has(service.id) && service.kind === kind,
    );
    if (created) showSurface(`service:${created.id}`);
    else broadcastState();
    return created;
  };

  handleShell(
    "shell:add-service",
    (_event, kind: ServiceKind, name?: string, newGoogleAccount?: boolean) => {
      addServiceAndShow(kind, name, newGoogleAccount);
      return { ok: true, state: shellStatePayload() };
    },
  );

  /** Nova aba do ADR Browser, já com o cursor na barra de endereço. */
  const openNewBrowserTab = (): void => {
    // Mesmo caminho da aba aberta por link/duplicada (erros e toast inclusos).
    if (openUrlInBrowserTab("", undefined, true)) focusAddressBar();
  };

  /** Fecha a aba e ativa a vizinha, como no Chrome. Só abas do ADR Browser. */
  const closeBrowserTab = (serviceId: string): void => {
    const ids = browserTabServices().map((s) => s.id);
    if (!ids.includes(serviceId)) return;
    removeServiceById(serviceId, tabAfterClose(ids, serviceId));
  };

  /** Ctrl+Tab/Ctrl+Shift+Tab entre as abas do ADR Browser. */
  const cycleBrowserTab = (step: 1 | -1): void => {
    const active = activeService();
    if (!active || !hasTabStrip(active.kind)) return;
    const next = cycleTab(
      browserTabServices().map((s) => s.id),
      active.id,
      step,
    );
    if (next && next !== active.id) showSurface(`service:${next}`, true);
  };

  /**
   * Aba nova do ADR Browser já na `url` (vazia = página inicial), logo depois
   * de `afterId` — onde o Chrome põe link aberto em nova aba e aba duplicada.
   * Sem `activate` fica no fundo e só carrega quando for aberta, como as
   * hibernadas. Declaração de função: as views (criadas antes desta linha)
   * chamam isto pelo menu e pelos links.
   */
  function openUrlInBrowserTab(
    url: string,
    afterId: string | undefined,
    activate: boolean,
  ): ServiceInstance | undefined {
    // Menu "Abrir link em nova aba"/"Pesquisar…" com a loja: não cria aba que
    // derrubaria o app ao carregar (ver isChromeWebStoreUrl).
    if (url && isChromeWebStoreUrl(url)) {
      openExternalServiceUrl(url);
      return undefined;
    }
    const previousIds = new Set(appState.services.map((s) => s.id));
    try {
      appState = addServiceToWorkspace(appState, "browser");
    } catch (error) {
      pushLog("error", "nova aba", String(error));
      showToast("Não foi possível abrir uma nova aba.");
      return undefined;
    }
    const created = orderedServicesForWorkspace(appState, workspaceId).find(
      (s) => !previousIds.has(s.id) && s.kind === "browser",
    );
    if (created) {
      if (url) suspendedBrowserUrls.set(created.id, browserRestoreUrl(created.startUrl, url));
      if (afterId) {
        const ids = browserTabServices().map((s) => s.id);
        const rail = mergeTabOrderIntoRail(
          railOrderForWorkspace(appState, workspaceId),
          ids,
          moveTabAfter(ids, created.id, afterId),
        );
        if (rail) appState = reorderWorkspaceRail(appState, workspaceId, rail);
      }
    }
    saveAppStateAtomic(statePath, appState);
    syncServiceViews();
    if (created && activate) showSurface(`service:${created.id}`, true);
    else {
      broadcastState();
      pushBrowserTabs();
    }
    return created;
  }

  /** Endereço atual da aba, mesmo hibernada. */
  function browserTabUrl(id: string): string {
    const live = serviceViews.get(id)?.webContents;
    const url = live && !live.isDestroyed() ? live.getURL() : "";
    return url && !url.startsWith("data:") ? url : suspendedBrowserUrls.get(id) || "";
  }

  /** Ctrl+Shift+K e "Duplicar" no menu da aba. */
  function duplicateBrowserTab(id: string): void {
    openUrlInBrowserTab(browserTabUrl(id), id, true);
  }

  function closeOtherBrowserTabs(keepId: string): void {
    if (activeService()?.id !== keepId) showSurface(`service:${keepId}`, true);
    for (const tab of browserTabServices()) if (tab.id !== keepId) removeServiceById(tab.id);
  }

  function closeBrowserTabsToRight(id: string): void {
    const right = tabsToTheRight(
      browserTabServices().map((s) => s.id),
      id,
    );
    if (right.includes(activeService()?.id ?? "")) showSurface(`service:${id}`, true);
    for (const tabId of right) removeServiceById(tabId);
  }

  function toggleBrowserTabMute(id: string): void {
    const contents = serviceViews.get(id)?.webContents;
    if (!contents || contents.isDestroyed()) return;
    const muted = !contents.isAudioMuted();
    contents.setAudioMuted(muted);
    if (muted) mutedBrowserTabs.add(id);
    else mutedBrowserTabs.delete(id);
    pushBrowserTabs(true);
  }

  /** Botão direito numa aba da faixa. */
  function showBrowserTabMenu(id: string): void {
    const ids = browserTabServices().map((s) => s.id);
    const live = serviceViews.get(id)?.webContents;
    const contents = live && !live.isDestroyed() ? live : undefined;
    Menu.buildFromTemplate([
      {
        label: "Nova aba à direita",
        click: () => {
          if (openUrlInBrowserTab("", id, true)) focusAddressBar();
        },
      },
      { type: "separator" },
      {
        label: "Recarregar",
        enabled: Boolean(contents),
        // Relida no clique: a aba pode ter hibernado com o menu aberto.
        click: () => {
          const now = serviceViews.get(id)?.webContents;
          if (now && !now.isDestroyed()) now.reload();
        },
      },
      {
        label: "Duplicar",
        accelerator: "CmdOrCtrl+Shift+K",
        registerAccelerator: false,
        click: () => duplicateBrowserTab(id),
      },
      {
        label: contents?.isAudioMuted() ? "Ativar som da aba" : "Silenciar aba",
        enabled: Boolean(contents),
        click: () => toggleBrowserTabMute(id),
      },
      { type: "separator" },
      {
        label: "Fechar",
        accelerator: "CmdOrCtrl+W",
        registerAccelerator: false,
        click: () => closeBrowserTab(id),
      },
      {
        label: "Fechar outras abas",
        enabled: ids.length > 1,
        click: () => closeOtherBrowserTabs(id),
      },
      {
        label: "Fechar abas à direita",
        enabled: tabsToTheRight(ids, id).length > 0,
        click: () => closeBrowserTabsToRight(id),
      },
      { type: "separator" },
      {
        label: "Reabrir aba fechada",
        accelerator: "CmdOrCtrl+Shift+T",
        registerAccelerator: false,
        enabled: closedBrowserTabs.hasFor(workspaceId),
        click: () => reopenClosedBrowserTab(),
      },
      {
        label: "Histórico",
        accelerator: "CmdOrCtrl+H",
        registerAccelerator: false,
        click: () => openHistoryWindow(),
      },
    ]).popup({ window: win });
  }

  /** Grava a visita e o endereço atual da aba (para reabrir o app nela). */
  function recordBrowserVisit(serviceId: string, url: string, title: string): void {
    browserHistory.visit(url, title);
    browserHistory.setTab(serviceId, { url, title });
    if (isRecordableUrl(url)) notifyHistoryChanged();
  }

  /**
   * Janela do histórico (Ctrl+H), filha da do app. Página local do shell com
   * preload próprio e sessão só dela, em memória: não vê cookie de site nenhum.
   * Os canais history:* só respondem a ela (handleHistory).
   */
  let historyWindow: BrowserWindow | null = null;
  let historyChangedTimer: NodeJS.Timeout | undefined;
  function notifyHistoryChanged(): void {
    if (!historyWindow || historyWindow.isDestroyed()) return;
    clearTimeout(historyChangedTimer);
    historyChangedTimer = setTimeout(() => {
      if (historyWindow && !historyWindow.isDestroyed()) {
        historyWindow.webContents.send("history:changed");
      }
    }, 400);
  }
  function openHistoryWindow(): void {
    if (historyWindow && !historyWindow.isDestroyed()) {
      if (historyWindow.isMinimized()) historyWindow.restore();
      historyWindow.focus();
      return;
    }
    const created = new BrowserWindow({
      parent: win,
      width: 960,
      height: 720,
      minWidth: 520,
      minHeight: 420,
      title: "Histórico — ADR Browser",
      show: false,
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#0d1526" : "#f4f6f8",
      webPreferences: {
        preload: path.join(opts.dirname, "../shell/history-preload.cjs"),
        partition: "adr-history-ui",
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    historyWindow = created;
    if (!appIcon.isEmpty()) created.setIcon(appIcon);
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    created.webContents.on("will-navigate", (event) => event.preventDefault());
    created.once("ready-to-show", () => created.show());
    created.on("closed", () => {
      if (historyWindow === created) historyWindow = null;
    });
    void created.loadFile(path.join(opts.dirname, "../shell/history.html"));
  }

  /**
   * Ctrl+= / Ctrl+- / Ctrl+roda (direção) e clique no indicador (0 = 100%).
   * Vale para o site inteiro, em todas as abas dele, como no Chrome.
   */
  function stepPageZoom(view: WebContentsView, direction: 1 | -1 | 0): void {
    const contents = view.webContents;
    let host = "";
    try {
      host = new URL(contents.getURL()).hostname;
    } catch {
      return;
    }
    if (!host) return;
    const next = direction === 0 ? 1 : nextZoomLevel(sitePageZoom(contents), direction);
    if (next === 1) siteZoomLevels.delete(host);
    else siteZoomLevels.set(host, next);
    for (const other of serviceViews.values()) applyPageZoom(other.webContents);
    if (activeServiceView() === view) {
      browserToolbar?.webContents.send("browser:zoom", Math.round(next * 100));
    }
  }

  handleShell("shell:rename-service", (_event, serviceId: string, name: string) => {
    renameServiceById(String(serviceId), String(name || ""));
    return { ok: true, state: shellStatePayload() };
  });

  handleShell("shell:remove-service", (_event, serviceId: string) => {
    const id = String(serviceId || "");
    removeServiceById(id);
    return { ok: true, state: shellStatePayload() };
  });

  handleShell("shell:service-context-menu", (_event, serviceId: string) => {
    const id = String(serviceId || "");
    const service = appState.services.find(
      (item) => item.id === id && item.workspaceId === workspaceId && !item.deletedAt,
    );
    if (!service) return { ok: false };
    const view = serviceViews.get(id);
    const hibernated = !view;
    // Abas do ADR Browser que o ícone da lateral representa (0 fora do Browser).
    const browserTabCount = hasTabStrip(service.kind) ? browserTabServices().length : 0;
    const menu = Menu.buildFromTemplate([
      {
        label: "Abrir",
        click: () => showSurface(`service:${id}`, true),
      },
      ...(service.kind === "meet"
        ? [
            ...(meet.isServiceInCall(id)
              ? [{ label: "Ocultar mini-janela desta reunião", click: () => meet.hideMiniForCurrentCall(id) }]
              : []),
            // Caminho que não depende do toast do Windows (desligado, perdido).
            ...(meet.hasLoggableCall()
              ? [{ label: "Registrar a última reunião no CRM…", click: () => meet.registerLastCall() }]
              : []),
            {
              label: "Mini-janela durante reuniões",
              type: "checkbox" as const,
              checked: appState.settings.meetMiniWindow,
              click: (item: Electron.MenuItem) => {
                appState = parseAppState({
                  ...appState,
                  settings: { ...appState.settings, meetMiniWindow: item.checked },
                });
                saveAppStateAtomic(statePath, appState);
                layout();
                broadcastState();
              },
            },
            { type: "separator" as const },
          ]
        : []),
      ...(service.kind === "whatsapp" && isWhatsAppLocked(id)
        ? [
            {
              label: whatsappUnlocked.has(id) ? "Bloquear agora" : "Desbloquear…",
              click: () => {
                if (whatsappUnlocked.has(id)) {
                  lockWhatsApp(id);
                  showToast(`WhatsApp bloqueado: ${service.name}`);
                } else {
                  showSurface(`service:${id}`, true);
                }
              },
            },
          ]
        : []),
      {
        label: "Recarregar",
        enabled: !hibernated,
        // A view de agora, não a da hora do menu: a hibernação ou a recriação
        // pós-crash podem ter trocado/destruído a outra com o menu aberto.
        click: () => {
          const current = serviceViews.get(id)?.webContents;
          if (current && !current.isDestroyed()) current.reload();
        },
      },
      // Só serviços com contador (WhatsApp, Gmail). Volta a aparecer quando o
      // número passa do que havia agora — ver nextClearedUnread.
      ...(badgeUnread.has(id)
        ? [
            {
              label: "Limpar notificações",
              enabled: visibleUnread(id) > 0,
              click: () => {
                setClearedUnread(id, badgeUnread.get(id) || 0);
                refreshTrayBadge();
                broadcastState();
              },
            },
          ]
        : []),
      // Com várias abas o ícone representa todas: renomear mudaria só uma.
      ...(browserTabCount > 1
        ? []
        : [
            {
              label: "Renomear…",
              click: () => {
                void showPrompt("Renomear serviço", service.name, "Salvar").then((name) => {
                  if (name) renameServiceById(id, name);
                });
              },
            },
          ]),
      {
        label:
          ownsSession(service.kind)
            ? "Duplicar (nova sessão)"
            : "Duplicar (mesma conta)",
        click: () => duplicateServiceById(id),
      },
      ...(usesSharedGoogleSession(service.kind) || usesSharedMicrosoftSession(service.kind)
        ? [
            {
              label: usesSharedGoogleSession(service.kind)
                ? "Duplicar (outra conta Google)"
                : "Duplicar (outra conta Microsoft)",
              click: () => duplicateServiceById(id, { newGoogleAccount: true }),
            },
          ]
        : []),
      { type: "separator" },
      {
        label: "Fixar no início",
        type: "checkbox",
        checked: service.pinned,
        click: (item) => setServicePinned(id, item.checked),
      },
      {
        label: "Manter em memória (não hibernar)",
        type: "checkbox",
        checked: service.keepAwake,
        click: (item) => {
          appState = parseAppState({
            ...appState,
            services: appState.services.map((candidate) =>
              candidate.id === id ? { ...candidate, keepAwake: item.checked } : candidate,
            ),
          });
          saveAppStateAtomic(statePath, appState);
          broadcastState();
        },
      },
      {
        label: hibernated ? "Reabrir" : "Hibernar",
        click: () => {
          if (hibernated) showSurface(`service:${id}`, true);
          else hibernateServiceView(id, { reason: "manual" });
        },
      },
      // Saída externa como opção, não como plano B obrigatório: este build é o
      // da CastLabs (Widevine + assinatura VMP), então o conteúdo protegido
      // toca aqui dentro. Serve para quando o usuário quer o Chrome mesmo.
      ...(service.kind === "browser" || service.kind === "spotify" || service.kind === "youtube"
        ? [
            { type: "separator" as const },
            {
              label: `Abrir no ${externalBrowserLabel()}`,
              click: () => {
                const current = serviceViews.get(id)?.webContents;
                const url = (current && !current.isDestroyed() && current.getURL()) || service.startUrl;
                void openInPreferredBrowser(url, preferredBrowser());
              },
            },
          ]
        : []),
      { type: "separator" },
      browserTabCount > 1
        ? {
            // O ícone do ADR Browser é todas as abas: "Excluir" apagaria só a
            // que ele representa no momento.
            label: `Fechar todas as abas (${browserTabCount})…`,
            click: () => {
              void dialog
                .showMessageBox(win, {
                  type: "warning",
                  title: "Fechar abas do ADR Browser",
                  message: `Fechar as ${browserTabCount} abas do ADR Browser?`,
                  detail: "Ctrl+Shift+T reabre as últimas fechadas enquanto o app estiver aberto.",
                  buttons: ["Cancelar", "Fechar todas"],
                  defaultId: 0,
                  cancelId: 0,
                })
                .then(({ response }) => {
                  if (response !== 1) return;
                  for (const tab of browserTabServices()) removeServiceById(tab.id);
                });
            },
          }
        : {
            label: "Excluir…",
            click: () => {
              void dialog
                .showMessageBox(win, {
                  type: "warning",
                  title: "Excluir aplicativo",
                  message: `Excluir ${service.name}?`,
                  detail: "A sessão fica preservada para recuperação durante 30 dias.",
                  buttons: ["Cancelar", "Excluir"],
                  defaultId: 0,
                  cancelId: 0,
                })
                .then(({ response }) => {
                  if (response === 1) removeServiceById(id);
                });
            },
          },
    ]);
    menu.popup({ window: win });
    return { ok: true };
  });

  const setCrmAudioMuted = (muted: boolean): void => {
    appState = parseAppState({
      ...appState,
      settings: { ...appState.settings, crmAudioMuted: muted },
    });
    saveAppStateAtomic(statePath, appState);
    for (const view of crmViews.values()) view.webContents.setAudioMuted(muted);
    broadcastState();
  };

  handleShell("shell:set-crm-muted", (_event, muted?: boolean) => {
    setCrmAudioMuted(typeof muted === "boolean" ? muted : !appState.settings.crmAudioMuted);
    return { ok: true, crmAudioMuted: appState.settings.crmAudioMuted };
  });

  const currentWhatsAppService = (serviceId: string): ServiceInstance | undefined =>
    appState.services.find(
      (service) =>
        service.id === serviceId &&
        service.workspaceId === workspaceId &&
        service.kind === "whatsapp" &&
        !service.deletedAt,
    );

  const lockWhatsApp = (targetServiceId?: string): { ok: boolean; message: string } => {
    if (targetServiceId) {
      if (!currentWhatsAppService(targetServiceId)) {
        return { ok: false, message: "Sessão do WhatsApp não encontrada neste workspace" };
      }
      whatsappUnlocked.delete(targetServiceId);
      whatsappLastActive.delete(targetServiceId);
      closeServiceDevTools(targetServiceId);
      if (activeService()?.id === targetServiceId) showSurface("settings");
      else broadcastState();
      return { ok: true, message: "WhatsApp bloqueado" };
    }
    for (const id of whatsappUnlocked) closeServiceDevTools(id);
    whatsappUnlocked.clear();
    whatsappLastActive.clear();
    if (activeService()?.kind === "whatsapp") showSurface("settings");
    else broadcastState();
    return { ok: true, message: "Todas as sessões do WhatsApp foram bloqueadas" };
  };

  handleShell("shell:enable-whatsapp-lock", async (_event, serviceId: string) => {
    const target = lockManager.target(serviceId, workspaceId);
    if (!target.ok) return target;
    const { service, lock } = target;
    const refusal = lockManager.enableRefusal(service, lock);
    if (refusal) return { ok: false, message: refusal };
    const pin = await askPin(
      `Criar PIN: ${service.name}`,
      "",
      "Continuar",
      true,
      "Escolha um PIN numérico de 4 a 12 dígitos.",
      "PIN",
    );
    if (!pin) return { ok: false, message: "Ativação cancelada" };
    const confirmation = await askPin(
      "Confirme o PIN",
      "",
      "Ativar",
      true,
      "Digite novamente o mesmo PIN para confirmar.",
      "Confirmar PIN",
    );
    if (!confirmation) return { ok: false, message: "Ativação cancelada" };
    if (pin !== confirmation) return { ok: false, message: "PINs não conferem" };
    try {
      lockManager.enable(service, lock, pin);
      return lockWhatsApp(service.id);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Não foi possível ativar",
      };
    }
  });

  /** Desliga o bloqueio de uma sessão (regras no lockManager) e reflete na UI. */
  const removeWhatsAppLock = (lock: WhatsAppLock, serviceId: string): void => {
    lockManager.remove(serviceId, lock);
    whatsappUnlocked.add(serviceId);
    broadcastState();
  };

  handleShell("shell:disable-whatsapp-lock", async (_event, serviceId: string) => {
    const target = lockManager.target(serviceId, workspaceId);
    if (!target.ok) return target;
    const { service, lock } = target;
    // Sem isto, uma sessão sem bloqueio (cofre ausente) caía no diálogo de
    // recuperação, como se o PIN dela tivesse sumido.
    if (!lockManager.isLocked(service.id)) return { ok: true, message: "Bloqueio já está desativado" };
    const pinState = lock.pinState();
    // Criptografia fora do ar não é PIN perdido: o arquivo pode estar íntegro, e
    // oferecer a recuperação aqui desativaria o bloqueio sem pedir o PIN.
    if (pinState === "unavailable") return LOCK_STORAGE_UNAVAILABLE;
    if (pinState !== "ok") {
      const recovery = await dialog.showMessageBox(win, {
        type: "warning",
        title: "Recuperar bloqueio do WhatsApp",
        message: `PIN de ${service.name} indisponível`,
        detail:
          "O arquivo cifrado não existe ou não pode ser lido. Desativar o bloqueio remove a proteção desta sessão e não pode ser desfeito automaticamente.",
        buttons: ["Cancelar", "Desativar bloqueio"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (recovery.response !== 1) return { ok: false, message: "Recuperação cancelada" };
      removeWhatsAppLock(lock, service.id);
      return { ok: true, message: "Bloqueio recuperado e desativado" };
    }
    const lockoutMs = pinThrottle.remainingLockoutMs(lock.throttleKey);
    if (lockoutMs > 0) return { ok: false, message: pinLockoutMessage(lockoutMs) };
    const pin = await askPin(
      `PIN atual: ${service.name}`,
      "",
      "Desativar",
      true,
      "Digite o PIN atual para desativar o bloqueio.",
      "PIN",
    );
    if (!pin) return { ok: false, message: "Desativação cancelada" };
    const verified = verifyWhatsAppPin(lock, pin);
    if (!verified.ok) return { ok: false, message: verified.message };
    removeWhatsAppLock(lock, service.id);
    return { ok: true, message: "Bloqueio desativado" };
  });

  handleShell("shell:change-whatsapp-pin", async (_event, serviceId: string) => {
    const target = lockManager.target(serviceId, workspaceId);
    if (!target.ok) return target;
    const { service, lock } = target;
    const pinState = lock.pinState();
    if (pinState === "unavailable") return LOCK_STORAGE_UNAVAILABLE;
    if (pinState !== "ok") {
      return { ok: false, message: "Ative o bloqueio primeiro para definir um PIN" };
    }
    const lockoutMs = pinThrottle.remainingLockoutMs(lock.throttleKey);
    if (lockoutMs > 0) return { ok: false, message: pinLockoutMessage(lockoutMs) };
    const currentPin = await askPin(
      `PIN atual: ${service.name}`,
      "",
      "Continuar",
      true,
      "Digite o PIN atual da sessão.",
      "PIN atual",
    );
    if (!currentPin) return { ok: false, message: "Alteração cancelada" };
    const verified = verifyWhatsAppPin(lock, currentPin);
    if (!verified.ok) return { ok: false, message: verified.message };

    const newPin = await askPin(
      "Novo PIN",
      "",
      "Continuar",
      true,
      "Escolha um novo PIN numérico de 4 a 12 dígitos.",
      "Novo PIN",
    );
    if (!newPin) return { ok: false, message: "Alteração cancelada" };
    const confirmation = await askPin(
      "Confirme o novo PIN",
      "",
      "Salvar",
      true,
      "Digite novamente o novo PIN para confirmar.",
      "Confirmar novo PIN",
    );
    if (!confirmation) return { ok: false, message: "Alteração cancelada" };
    if (newPin !== confirmation) return { ok: false, message: "PINs não conferem" };

    try {
      lock.setPin(newPin);
      return { ok: true, message: "PIN atualizado com sucesso" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Não foi possível alterar o PIN",
      };
    }
  });

  handleShell("shell:set-whatsapp-lock-on-leave", (_event, serviceId: string, onLeave: boolean) => {
    if (!currentWhatsAppService(serviceId)) {
      return { ok: false, message: "Sessão do WhatsApp não encontrada" };
    }
    const nextOnLeave = {
      ...appState.settings.whatsappLockOnLeaveServiceIds,
      [String(serviceId)]: Boolean(onLeave),
    };
    appState = parseAppState({
      ...appState,
      settings: { ...appState.settings, whatsappLockOnLeaveServiceIds: nextOnLeave },
    });
    saveAppStateAtomic(statePath, appState);
    broadcastState();
    return { ok: true, onLeave: Boolean(onLeave) };
  });

  handleShell("shell:set-whatsapp-lock-timeout", (_event, serviceId: string, minutes?: number) => {
    const id = String(serviceId || "");
    const target = appState.services.find(
      (service) =>
        service.id === id &&
        service.workspaceId === workspaceId &&
        service.kind === "whatsapp" &&
        !service.deletedAt,
    );
    if (!target) return { ok: false, message: "Sessão do WhatsApp não encontrada" };
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
      return { ok: false, message: "Informe um tempo entre 0 e 1440 minutos" };
    }
    const valid = Math.round(minutes);
    const timeoutIds = {
      ...appState.settings.whatsappLockTimeoutServiceMinutes,
      [id]: valid,
    };
    appState = parseAppState({
      ...appState,
      settings: { ...appState.settings, whatsappLockTimeoutServiceMinutes: timeoutIds },
    });
    saveAppStateAtomic(statePath, appState);
    broadcastState();
    return {
      ok: true,
      timeoutMinutes: valid,
      message: valid
        ? `Bloqueio por inatividade: ${valid} min`
        : "Bloqueio por inatividade desativado",
    };
  });

  handleShell("shell:lock-whatsapp", (_event, serviceId?: string) => lockWhatsApp(serviceId));

  handleShell("shell:crm-context-menu", () => {
    const notifOn = shouldAllowServiceNotification(notifSettings(), CRM_SURFACE_ID);
    Menu.buildFromTemplate([
      { label: "Abrir", click: () => showSurface("crm") },
      { label: "Recarregar", click: () => ensureCrmView(workspaceId).webContents.reload() },
      { type: "separator" },
      {
        label: "Silenciar áudio",
        type: "checkbox",
        checked: appState.settings.crmAudioMuted,
        click: (item) => setCrmAudioMuted(item.checked),
      },
      {
        label: "Notificações bloqueadas",
        type: "checkbox",
        checked: notifOn,
        enabled: false,
      },
    ]).popup({ window: win });
    return { ok: true };
  });

  handleShell("shell:set-hibernate-after", (_event, serviceId: string, minutes: unknown) => {
    const id = String(serviceId || "");
    requireCurrentService(id);
    if (minutes !== null && (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) {
      return { ok: false, message: "Escolha um prazo entre 1 e 1440 minutos" };
    }
    appState = parseAppState({
      ...appState,
      services: appState.services.map((service) => service.id === id
        ? { ...service, hibernateAfterMinutes: minutes ?? undefined } : service),
    });
    saveAppStateAtomic(statePath, appState);
    void enforceHibernation();
    broadcastState();
    return { ok: true };
  });

  handleShell("shell:set-keep-awake", (_event, serviceId: string, keepAwake: boolean) => {
    const id = String(serviceId || "");
    requireCurrentService(id);
    appState = parseAppState({
      ...appState,
      services: appState.services.map((s) =>
        s.id === id ? { ...s, keepAwake: Boolean(keepAwake) } : s,
      ),
    });
    saveAppStateAtomic(statePath, appState);
    void enforceHibernation();
    broadcastState();
    return { ok: true, state: shellStatePayload() };
  });

  /** Recria a view: trocar a conta troca a partição, e partição é fixada na criação. */
  const reloadServiceView = (serviceId: string): void => {
    suspendedBrowserUrls.delete(serviceId);
    suspendedBrowserHistory.delete(serviceId);
    const wasActive = activeSurface === `service:${serviceId}`;
    const view = serviceViews.get(serviceId);
    if (view) {
      recovery.unregister(serviceId);
      const ses = view.webContents.session;
      win.contentView.removeChildView(view);
      closeView(view);
      serviceViews.delete(serviceId);
      needsInitialLoad.delete(serviceId);
      loadingServiceIds.delete(serviceId);
      failedServiceIds.delete(serviceId);
      closeConnectionsIfUnused(ses);
    }
    if (wasActive) showSurface(`service:${serviceId}`);
    else broadcastState();
  };

  handleShell("shell:google-logout", async (_event, profileId?: string) => {
    // Sem profileId mantém o comportamento antigo (a conta do workspace); com
    // várias contas, limpar "a primeira que achou" apagaria a sessão errada.
    if (
      profileId &&
      !listGoogleProfilesForWorkspace(appState, workspaceId).some((profile) => profile.id === profileId)
    ) {
      return { ok: false, message: "Conta Google não pertence a este workspace" };
    }
    const partitionName = profileId
      ? googlePartitionForProfile(appState, profileId)
      : googlePartitionForWorkspace(appState, workspaceId);
    if (!partitionName) return { ok: false, message: "Sem perfil Google neste workspace" };
    // clearStorageData() sem filtro limpava a partição INTEIRA — e ela é dividida
    // com Spotify e ADR Browser. Sair do Google derrubava o login do Spotify.
    const googleSession = session.fromPartition(partitionName);
    const cookies = await googleSession.cookies.get({});
    try {
      await Promise.all(
        cookies
          .filter((cookie) => isGoogleAuthDomain(cookie.domain || ""))
          .map((cookie) => {
            const host = (cookie.domain || "").replace(/^\./, "");
            const url = `${cookie.secure ? "https" : "http"}://${host}${cookie.path || "/"}`;
            return googleSession.cookies.remove(url, cookie.name);
          }),
      );
      await Promise.all(
        GOOGLE_AUTH_ORIGINS.map((origin) =>
          googleSession.clearStorageData({
            origin,
            storages: ["localstorage", "indexdb", "serviceworkers", "cachestorage"],
          }),
        ),
      );
    } catch (error) {
      pushLog("error", "google logout incompleto", { profileId, error: String(error) });
      return { ok: false, message: "Não foi possível limpar toda a sessão Google. Tente novamente." };
    }
    for (const [id, view] of serviceViews) {
      const svc = appState.services.find((s) => s.id === id);
      if (!svc || svc.deletedAt || !usesSharedGoogleSession(svc.kind)) continue;
      if (profileId && svc.profileId !== profileId) continue;
      // Ainda sem carga inicial (talvez 0×0): a primeira exibição já carrega a
      // home com a sessão limpa. Carregar aqui duplicaria a carga.
      if (needsInitialLoad.has(id) || view.webContents.isDestroyed()) continue;
      // Browser, Spotify e YouTube funcionam sem conta: recarregar perdia a página
      // aberta e parava a música. Meet em chamada também fica — derrubaria a reunião.
      const keepsPage =
        svc.kind === "browser" || svc.kind === "spotify" || svc.kind === "youtube"
          ? !isGoogleAccountsUrl(view.webContents.getURL())
          : svc.kind === "meet" && meet.inCall(view.webContents);
      if (svc.kind === "gmail") clearServiceUnread(id);
      if (keepsPage) continue;
      void view.webContents.loadURL(serviceUrl(svc.kind));
    }
    pushLog("info", "google session cleared", partitionName);
    return { ok: true, partitionName };
  });

  /**
   * Sair de uma conta Microsoft: a partição é só do Outlook/Teams daquela
   * conta (diferente da Google, dividida com Spotify e ADR Browser), então
   * limpa inteira e recarrega os serviços que a usam.
   */
  handleShell("shell:microsoft-logout", async (_event, profileId: string) => {
    const profile = listMicrosoftProfilesForWorkspace(appState, workspaceId).find(
      (p) => p.id === profileId,
    );
    if (!profile) return { ok: false, message: "Conta Microsoft não pertence a este workspace" };
    try {
      await session.fromPartition(profile.partitionName).clearStorageData();
    } catch (error) {
      pushLog("error", "microsoft logout incompleto", { profileId, error: String(error) });
      return { ok: false, message: "Não foi possível limpar toda a sessão Microsoft. Tente novamente." };
    }
    // A casa lembrada e o contador eram da conta que saiu: a próxima pode ser de
    // outro tipo (pessoal/empresa), e a tela de login não manda contador.
    const ofAccount = (s: ServiceInstance): boolean => !s.deletedAt && s.profileId === profile.id;
    appState = parseAppState({
      ...appState,
      services: appState.services.map((s) => (ofAccount(s) ? { ...s, startUrl: serviceUrl(s.kind) } : s)),
    });
    saveAppStateAtomic(statePath, appState);
    for (const svc of appState.services.filter(ofAccount)) clearServiceUnread(svc.id);
    for (const [id, view] of serviceViews) {
      const svc = appState.services.find((s) => s.id === id);
      if (!svc || !ofAccount(svc)) continue;
      if (needsInitialLoad.has(id) || view.webContents.isDestroyed()) continue;
      void view.webContents.loadURL(serviceHome(svc));
    }
    pushLog("info", "microsoft session cleared", profile.partitionName);
    return { ok: true };
  });

  handleShell("shell:rename-microsoft-account", (_event, profileId: string, name: string) => {
    if (!listMicrosoftProfilesForWorkspace(appState, workspaceId).some((p) => p.id === profileId)) {
      throw new Error("Conta Microsoft não pertence a este workspace");
    }
    appState = renameMicrosoftProfile(appState, String(profileId || ""), String(name || ""));
    saveAppStateAtomic(statePath, appState);
    broadcastState();
    return { ok: true, state: shellStatePayload() };
  });

  handleShell(
    "shell:set-service-microsoft-account",
    (_event, serviceId: string, profileId: string) => {
      const id = String(serviceId || "");
      requireCurrentService(id);
      appState = reassignServiceMicrosoftProfile(appState, id, String(profileId || ""));
      saveAppStateAtomic(statePath, appState);
      clearServiceUnread(id);
      reloadServiceView(id);
      return { ok: true, state: shellStatePayload() };
    },
  );

  handleShell("shell:set-contacts-account", (_event, email: string) => {
    appState = parseAppState({
      ...appState,
      settings: { ...appState.settings, contactsGoogleAccount: String(email || "") },
    });
    saveAppStateAtomic(statePath, appState);
    broadcastState();
    return { ok: true, state: shellStatePayload() };
  });

  handleShell("shell:rename-google-account", (_event, profileId: string, name: string) => {
    if (!listGoogleProfilesForWorkspace(appState, workspaceId).some((profile) => profile.id === profileId)) {
      throw new Error("Conta Google não pertence a este workspace");
    }
    appState = renameGoogleProfile(appState, String(profileId || ""), String(name || ""));
    saveAppStateAtomic(statePath, appState);
    broadcastState();
    return { ok: true, state: shellStatePayload() };
  });

  handleShell(
    "shell:set-service-google-account",
    (_event, serviceId: string, profileId: string) => {
      const id = String(serviceId || "");
      requireCurrentService(id);
      appState = reassignServiceGoogleProfile(appState, id, String(profileId || ""));
      saveAppStateAtomic(statePath, appState);
      // O número era da conta antiga; a tela de login não traz contador no título.
      clearServiceUnread(id);
      reloadServiceView(id);
      return { ok: true, state: shellStatePayload() };
    },
  );

  handleShell("shell:reorder-services", (_event, orderedIds: string[]) => {
    // orderedIds é a barra inteira (ids dos serviços + o marcador "crm") vinda
    // da lista arrastável; reorderWorkspaceRail reordena os serviços e tira a
    // crmPosition do workspace de onde o "crm" caiu. A lateral mostra as abas do
    // ADR Browser num ícone só: ele volta a ser todas as abas, juntas.
    const tabIds = browserTabServices().map((s) => s.id);
    const full = expandRailBrowserTabs(
      Array.isArray(orderedIds) ? orderedIds.filter((id) => typeof id === "string") : [],
      tabIds,
      railBrowserTab(workspaceId),
    );
    appState = reorderWorkspaceRail(appState, workspaceId, full);
    saveAppStateAtomic(statePath, appState);
    broadcastState();
    return { ok: true, state: shellStatePayload() };
  });

  handleShell("shell:reorder-workspaces", (_event, orderedIds: string[]) => {
    appState = reorderWorkspaces(appState, orderedIds || []);
    saveAppStateAtomic(statePath, appState);
    broadcastState();
    return { ok: true, state: shellStatePayload() };
  });

  function activateWorkspace(id: string): boolean {
    if (!listActiveWorkspaces(appState).some((w) => w.id === id)) return false;
    if (workspaceId === id) return true;
    const previous = activeService();
    if (
      previous?.kind === "whatsapp" &&
      appState.settings.whatsappLockOnLeaveServiceIds[previous.id]
    ) {
      whatsappUnlocked.delete(previous.id);
      whatsappLastActive.delete(previous.id);
    }
    activeSurface = "crm";
    appState = setActiveWorkspace(appState, id);
    workspaceId = appState.activeWorkspaceId || id;
    saveAppStateAtomic(statePath, appState);
    closeInactiveCrmViews(workspaceId);
    syncServiceViews();
    for (const view of crmViews.values()) attachKeys(view.webContents);
    raiseChrome();
    armCrmGate(workspaceId);
    return true;
  }

  handleShell("shell:set-workspace", async (_event, id: string, surface?: string) => {
    if (!activateWorkspace(id)) return { ok: false, message: "Workspace indisponível" };
    // Sem esperar a primeira conferência do login, o portão de showSurface via
    // "desconhecido" como deslogado.
    const target = workspaceId;
    if (!crmLoginKnown.has(target)) {
      const loggedIn = await crmSessionHasLogin(target).catch(() => false);
      if (loggedIn) crmAuthenticatedWorkspaces.add(target);
      crmLoginKnown.add(target);
    }
    // O ícone clicado vem junto: passar pelo CRM antes carregava o app web
    // inteiro dele (centenas de MB) a cada troca, só para ficar escondido.
    if (workspaceId === target) showSurface(surface ? parseSurface(surface) : "crm", Boolean(surface));
    return { ok: true, state: shellStatePayload() };
  });

  handleShell("shell:create-workspace", (_event, name: string, color?: string) => {
    const crmProfileId = randomUUID();
    appState = createWorkspace(appState, {
      name: String(name || "Novo"),
      color: color || "#4da3ff",
      crmProfileId,
    });
    const created = listActiveWorkspaces(appState).at(-1);
    if (!created) throw new Error("falha ao criar workspace");
    appState = setActiveWorkspace(appState, created.id);
    workspaceId = created.id;
    appState = addServiceToWorkspace(appState, "whatsapp", "WhatsApp");
    saveAppStateAtomic(statePath, appState);
    closeInactiveCrmViews(workspaceId);
    syncServiceViews();
    for (const view of crmViews.values()) attachKeys(view.webContents);
    raiseChrome();
    showSurface("crm");
    armCrmGate(workspaceId);
    return { ok: true, state: shellStatePayload() };
  });

  const clampHour = (value: unknown, fallback: number): number => {
    const hour = Math.floor(Number(value));
    return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : fallback;
  };

  const setNotificationSettings = async (
    patch: Partial<NotificationSettings>,
  ): Promise<NotificationSettings> => {
    const current = notifSettings();
    const next: NotificationSettings = {
      enabled: patch.enabled ?? current.enabled,
      respectWhatsAppMute: patch.respectWhatsAppMute ?? current.respectWhatsAppMute,
      trayBadge: patch.trayBadge ?? current.trayBadge,
      quietHours: patch.quietHours ?? current.quietHours,
      // clampHour: o painel manda o valor cru do <input type="number">, e o zod
      // rejeitaria 25 lançando dentro do handler em vez de corrigir.
      quietFromHour: clampHour(patch.quietFromHour, current.quietFromHour),
      quietToHour: clampHour(patch.quietToHour, current.quietToHour),
      serviceEnabled: { ...current.serviceEnabled, ...(patch.serviceEnabled || {}), crm: false },
    };
    appState = parseAppState({
      ...appState,
      settings: { ...appState.settings, notifications: next },
    });
    saveAppStateAtomic(statePath, appState);
    refreshTrayBadge();
    await patchAllNotificationSettings();
    broadcastState();
    return next;
  };

  handleShell(
    "shell:update-notifications",
    async (_event, patch: Partial<NotificationSettings>) => {
      return { ok: true, notifications: await setNotificationSettings(patch) };
    },
  );

  handleShell(
    "shell:update-settings",
    (
      _event,
      patch: Partial<{
        theme: "light" | "dark" | "system";
        sidebarExpanded: boolean;
        sidebarPosition: SidebarPosition;
        browserToolbarPosition: BrowserToolbarPosition;
        adBlockEnabled: boolean;
        adBlockAllowlist: string[];
        preferredExternalBrowser: ExternalBrowserPreference;
        uiScale: number;
        maxLoadedViews: number;
        meetQuietNotifications: boolean;
        meetMiniWindow: boolean;
        meetMuteShortcut: boolean;
        meetLogToCrm: boolean;
        calendarReminderMinutes: number;
      }>,
    ) => {
      const flag = (value: unknown, current: boolean): boolean =>
        typeof value === "boolean" ? value : current;
      const reminderMinutes =
        typeof patch.calendarReminderMinutes === "number" && Number.isFinite(patch.calendarReminderMinutes)
          ? Math.min(30, Math.max(0, Math.round(patch.calendarReminderMinutes)))
          : appState.settings.calendarReminderMinutes;
      const theme = patch.theme ?? appState.settings.theme;
      const sidebarExpanded = patch.sidebarExpanded ?? appState.settings.sidebarExpanded;
      const sidebarPosition = patch.sidebarPosition ?? appState.settings.sidebarPosition;
      const browserToolbarPosition =
        patch.browserToolbarPosition ?? appState.settings.browserToolbarPosition;
      const adBlockEnabled = patch.adBlockEnabled ?? appState.settings.adBlockEnabled;
      const adBlockAllowlist =
        patch.adBlockAllowlist
          ?.map((value) => hostnameFromUrl(value.includes("://") ? value : `https://${value}`))
          .filter(Boolean) ?? appState.settings.adBlockAllowlist;
      const preferredExternalBrowser =
        patch.preferredExternalBrowser ?? appState.settings.preferredExternalBrowser;
      const uiScale = Math.min(2, Math.max(0.8, patch.uiScale ?? appState.settings.uiScale));
      const maxLoadedViews =
        patch.maxLoadedViews !== undefined
          ? Math.max(1, Math.floor(patch.maxLoadedViews))
          : appState.settings.maxLoadedViews;
      appState = parseAppState({
        ...appState,
        settings: {
          ...appState.settings,
          theme,
          sidebarExpanded,
          sidebarPosition,
          browserToolbarPosition,
          adBlockEnabled,
          adBlockAllowlist,
          preferredExternalBrowser,
          uiScale,
          ...(maxLoadedViews !== undefined ? { maxLoadedViews } : {}),
          meetQuietNotifications: flag(patch.meetQuietNotifications, appState.settings.meetQuietNotifications),
          meetMiniWindow: flag(patch.meetMiniWindow, appState.settings.meetMiniWindow),
          meetMuteShortcut: flag(patch.meetMuteShortcut, appState.settings.meetMuteShortcut),
          meetLogToCrm: flag(patch.meetLogToCrm, appState.settings.meetLogToCrm),
          calendarReminderMinutes: reminderMinutes,
        },
      });
      meet.syncShortcut();
      void patchAllNotificationSettings().catch(() => undefined);
      if (patch.calendarReminderMinutes !== undefined) void meet.refreshCalendar();
      applyNativeTheme(theme);
      syncThemeBackgrounds();
      browserToolbar?.webContents.send("browser:appearance", { theme });
      saveAppStateAtomic(statePath, appState);
      for (const view of serviceViews.values()) applyPageZoom(view.webContents);
      for (const view of crmViews.values()) view.webContents.setZoomFactor(uiZoom());
      void enforceHibernation();
      layout();
      broadcastState();
      pushBrowserToolbarState();
      return { ok: true, settings: appState.settings };
    },
  );

  /** Agenda do lembrete, permissões lembradas e backup: ver profile-ipc.ts. */
  registerProfileIpc({
    handle: (channel, fn) => handleShell(channel, fn as Parameters<typeof handleShell>[1]),
    parentWindow: win,
    settings: () => appState.settings,
    updateSettings: (change) => {
      appState = parseAppState({ ...appState, settings: change(appState.settings) });
      saveAppStateAtomic(statePath, appState);
    },
    refreshCalendar: () => meet.refreshCalendar(),
    broadcast: () => broadcastState(),
    notify: (text) => notify(text, { surface: "settings" }),
    log: (message, extra) => pushLog("info", message, extra),
    userData: app.getPath("userData"),
    backupScriptPath: app.isPackaged
      ? path.join(process.resourcesPath, "backup-profile.ps1")
      : path.join(opts.dirname, "../../build/backup-profile.ps1"),
    relaunchPath: app.isPackaged ? process.execPath : "",
    quitForBackup: () => {
      // Atualização adiada liga a instalação na saída; aqui a saída é para o
      // backup, que reabre o app — instalador e cópia ao mesmo tempo disputavam o
      // perfil. A atualização volta a ser oferecida depois.
      desktopUpdater.cancelInstallOnQuit();
      app.quit();
    },
  });
  setTimeout(() => {
    showPendingBackupNotice({
      parentWindow: win,
      userData: app.getPath("userData"),
      notify: (text) => notify(text, { surface: "settings" }),
    });
  }, BACKUP_NOTICE_DELAY_MS);

  handleShell("shell:crm-logout", async () => {
    const logoutWorkspaceId = workspaceId;
    opts.invalidateCrmSession(logoutWorkspaceId);
    const baseUrl = normalizeAllowedBaseUrl(CRM_URL, { allowLocalhost: !app.isPackaged });
    const partitionName = await logoutCrmWorkspace(
      (name) => session.fromPartition(name),
      logoutWorkspaceId,
      baseUrl,
    );
    crmAuthenticatedWorkspaces.delete(logoutWorkspaceId);
    if (workspaceId !== logoutWorkspaceId) return { ok: true, partitionName };
    ensureCrmView(workspaceId);
    loadCrmUrl(workspaceId);
    showSurface("crm");
    armCrmGate(workspaceId);
    return { ok: true, partitionName };
  });

  handleShell("shell:crm-panel", (_event, enabled: boolean) => {
    opts.setCrmPanelKillSwitch(
      applyCrmPanelKillSwitch(
        opts.getCrmPanelKillSwitch(),
        Boolean(enabled),
        enabled ? undefined : "user-disabled",
      ),
    );
    if (opts.getCrmPanelKillSwitch().enabled) {
      for (const [id, view] of serviceViews) {
        const svc = appState.services.find((s) => s.id === id);
        if (svc?.kind === "whatsapp") void injectWhatsAppGuards(view, id);
      }
    }
    return { ok: true, enabled: opts.getCrmPanelKillSwitch().enabled };
  });

  /**
   * Barra de navegação visível: em todo serviço menos o WhatsApp
   * (showsAddressBar), e TAMBÉM em qualquer serviço que tenha saído do site dele.
   *
   * Um link do Gmail que abre o Google Docs navega a PRÓPRIA view — só o
   * WhatsApp manda link para fora (ver `shouldOpenServiceUrlExternally`). Sem
   * barra não sobrava um "voltar" na tela: o único caminho era Ctrl+Shift+R,
   * que recarrega na home do serviço, e ninguém descobre isso sozinho. Ficar
   * preso num Docs sem saída é o mesmo beco da tela de login do Google, que já
   * ganhou cartão próprio.
   *
   * Declaração de função, não `const`: `layout` chama isto e nasce bem acima.
   */
  function serviceNeedsChrome(svc: ServiceInstance): boolean {
    if (showsAddressBar(svc.kind)) return true;
    return serviceDriftedOffSite(
      svc.kind,
      serviceViews.get(svc.id)?.webContents.getURL() || "",
      serviceUrl(svc.kind),
    );
  }

  /**
   * Os atalhos de navegador valem só aqui (ver hasBrowserChrome): a barra
   * agora aparece em quase todo serviço, mas o atalho da página vem primeiro.
   */
  function serviceUsesBrowserShortcuts(svc: ServiceInstance): boolean {
    if (hasBrowserChrome(svc.kind)) return true;
    return serviceDriftedOffSite(
      svc.kind,
      serviceViews.get(svc.id)?.webContents.getURL() || "",
      serviceUrl(svc.kind),
    );
  }

  /** Aparece/some a barra quando a view sai (ou volta) do site do serviço. */
  function syncBrowserChrome(svc: ServiceInstance): void {
    if (activeService()?.id !== svc.id) return;
    const wanted = serviceNeedsChrome(svc);
    // O próprio bounds da barra é o estado: layout() só roda quando muda, senão
    // toda navegação de SPA (Gmail troca de rota o tempo todo) repõe as views.
    if (wanted !== (browserToolbar?.getBounds().height || 0) > 0) layout();
    if (wanted) pushBrowserToolbarState();
  }

  const withActiveBrowserView = (): WebContentsView | null => {
    const svc = activeService();
    if (!svc || !serviceNeedsChrome(svc)) return null;
    return serviceViews.get(svc.id) || null;
  };

  const showVaultMessage = async (
    type: "info" | "warning" | "error",
    title: string,
    message: string,
    detail?: string,
  ): Promise<void> => {
    await dialog.showMessageBox(win, {
      type,
      title,
      message,
      ...(detail ? { detail } : {}),
      buttons: ["Entendi"],
    });
  };

  const importPasswordCsv = async (): Promise<void> => {
    try {
      if (!passwordVault.isAvailable()) {
        await showVaultMessage(
          "error",
          "Cofre indisponível",
          "A proteção de credenciais do Windows não está disponível.",
        );
        return;
      }
      const selected = await dialog.showOpenDialog(win, {
        title: "Importar senhas para o Cofre ADR",
        properties: ["openFile"],
        filters: [{ name: "Senhas em CSV", extensions: ["csv"] }],
      });
      const selectedPath = selected.filePaths[0];
      if (selected.canceled || !selectedPath) return;
      const csv = readPasswordCsvFile(selectedPath);
      const preview = passwordVault.previewCsv(csv);
      if (!preview.valid) {
        await showVaultMessage(
          "warning",
          "Nenhuma credencial válida",
          "O CSV não contém linhas válidas para importar.",
          "As colunas obrigatórias são url, username e password (no CSV do Bitwarden, login_uri, login_username e login_password).",
        );
        return;
      }
      const confirmation = await dialog.showMessageBox(win, {
        type: "question",
        title: "Confirmar importação",
        message: `Importar ${preview.valid} credencial(is) de ${preview.domains} site(s)?`,
        detail: preview.skipped
          ? `${preview.skipped} linha(s) inválida(s) serão ignoradas. O CSV será mantido no local original.`
          : "O CSV será mantido no local original.",
        buttons: ["Importar para o cofre", "Cancelar"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (confirmation.response !== 0) return;
      const result = passwordVault.importCsv(csv);
      pushBrowserToolbarState();
      await showVaultMessage(
        "info",
        "Importação concluída",
        `${result.imported} nova(s), ${result.updated} atualizada(s).`,
        `${result.total} credencial(is) no Cofre ADR. Por segurança, exclua o CSV original depois de confirmar que os logins funcionam.`,
      );
    } catch (error) {
      await showVaultMessage(
        "error",
        "Falha ao importar",
        error instanceof Error ? error.message : "Não foi possível importar o CSV.",
      );
    }
  };

  const fillVaultCredential = async (credentialId: string): Promise<void> => {
    const view = withActiveBrowserView();
    if (!view) return;
    const currentUrl = view.webContents.getURL();
    try {
      const credential = passwordVault.getForFill(credentialId, currentUrl);
      if (!credential) {
        await showVaultMessage(
          "warning",
          "Site diferente",
          "A credencial não pertence ao endereço atual.",
        );
        return;
      }
      // A origem conferida no script é a da página que getForFill aceitou (pode
      // ser subdomínio do site salvo): ela só barra a página ter trocado no meio.
      const result = (await view.webContents.executeJavaScript(
        buildPasswordFillScript(
          new URL(currentUrl).origin,
          credential.username,
          credential.password,
        ),
        true,
      )) as PasswordFillResult;
      if (!result.ok) {
        await showVaultMessage(
          "warning",
          "Campos não encontrados",
          "Abra a tela de login do site e tente novamente.",
        );
      } else {
        showToast("Credencial preenchida. Revise antes de entrar.");
      }
    } catch {
      await showVaultMessage(
        "error",
        "Falha ao preencher",
        "Não foi possível preencher a credencial nesta página.",
      );
    }
  };

  const saveCurrentCredential = async (): Promise<void> => {
    const view = withActiveBrowserView();
    const currentUrl = view?.webContents.getURL() || "";
    if (!view || !vaultStateFor(currentUrl).origin) {
      await showVaultMessage("warning", "Endereço inválido", "Abra primeiro a página de login.");
      return;
    }
    const username = await showPrompt("Usuário ou e-mail", "", "Continuar");
    if (!username) return;
    const password = await showPrompt("Senha", "", "Salvar no cofre", true, "", "Senha do site");
    if (!password) return;
    try {
      passwordVault.saveCredential(currentUrl, username, password);
      pushBrowserToolbarState();
      showToast("Credencial salva no Cofre ADR.");
    } catch (error) {
      await showVaultMessage(
        "error",
        "Falha ao salvar",
        error instanceof Error ? error.message : "Não foi possível salvar a credencial.",
      );
    }
  };

  /**
   * Bitwarden → Cofre ADR pela CLI oficial (ver bitwarden-cli.ts): pede a senha
   * mestra, desbloqueia, copia os logins e tranca. Uma sincronização por vez.
   */
  let bitwardenSyncRunning = false;
  const syncBitwardenIntoVault = async (): Promise<void> => {
    if (bitwardenSyncRunning) return;
    bitwardenSyncRunning = true;
    try {
      const bwPath = await findBitwardenCli();
      if (!bwPath) {
        await showVaultMessage(
          "info",
          "Instale a CLI do Bitwarden",
          "A sincronização usa a CLI oficial do Bitwarden, que não está instalada.",
          "No terminal: winget install Bitwarden.CLI — depois, uma vez só: bw login (aceita a verificação em duas etapas). Então volte aqui e sincronize.",
        );
        return;
      }
      // Antes da senha mestra: sem criptografia do sistema o Cofre não grava, e
      // a pessoa só descobriria depois de esperar o desbloqueio.
      if (!passwordVault.isAvailable()) {
        await showVaultMessage(
          "error",
          "Cofre indisponível",
          "A criptografia segura do Windows não está disponível neste perfil.",
        );
        return;
      }
      const run = createBwRunner(bwPath);
      const status = await bitwardenStatus(run);
      if (status === "unauthenticated") {
        await showVaultMessage(
          "info",
          "Entre na sua conta do Bitwarden",
          "A CLI do Bitwarden está instalada, mas sem conta conectada.",
          "No terminal, uma vez só: bw login (aceita a verificação em duas etapas). Depois sincronize de novo.",
        );
        return;
      }
      const masterPassword = await showPrompt(
        "Sincronizar com Bitwarden",
        "",
        "Sincronizar",
        true,
        "A senha mestra só desbloqueia o cofre para copiar os logins; não é guardada.",
        "Senha mestra do Bitwarden",
      );
      if (!masterPassword) return;
      showToast("Sincronizando com o Bitwarden…");
      const pulled = await pullBitwardenItems(run, masterPassword, status);
      const parsed = bitwardenItemsToEntries(pulled.items);
      const result = passwordVault.mirrorBitwarden(parsed);
      pushBrowserToolbarState();
      pushLog("info", "bitwarden sync", {
        novas: result.imported,
        atualizadas: result.updated,
        removidas: result.removed,
        ignoradas: parsed.skipped,
        online: pulled.synced,
      });
      await showVaultMessage(
        "info",
        "Bitwarden sincronizado",
        `${result.imported} nova(s), ${result.updated} atualizada(s), ${result.removed} removida(s).`,
        [
          `${result.total} credencial(is) no Cofre ADR.`,
          parsed.skipped
            ? `${parsed.skipped} item(ns) do Bitwarden ficaram de fora (notas, cartões, logins sem usuário/senha ou sem endereço web).`
            : "",
          pulled.synced ? "" : "Sem conexão com o servidor: foram usados os dados do último sync da CLI.",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (error) {
      await showVaultMessage(
        "error",
        "Falha ao sincronizar",
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível sincronizar com o Bitwarden.",
        error instanceof BitwardenError && error.code === "logged-out"
          ? "No terminal, uma vez só: bw login. Depois sincronize de novo."
          : undefined,
      );
    } finally {
      bitwardenSyncRunning = false;
    }
  };

  const showPasswordVaultMenu = async (): Promise<void> => {
    const view = withActiveBrowserView();
    const currentUrl = view?.webContents.getURL() || "";
    try {
      const status = passwordVault.status(currentUrl);
      const matches = passwordVault.listForUrl(currentUrl);
      const safeLabel = (value: string): string =>
        value
          .replace(/&/g, "&&")
          .replace(/[\r\n\t]/g, " ")
          .slice(0, 80);
      const template: Electron.MenuItemConstructorOptions[] = [];
      if (matches.length) {
        template.push({
          label: "Preencher credencial",
          submenu: matches.map((entry) => ({
            label: safeLabel(entry.username),
            click: () => void fillVaultCredential(entry.id),
          })),
        });
      } else {
        template.push({
          label: status.origin ? "Nenhuma credencial para este site" : "Abra uma página de login",
          enabled: false,
        });
      }
      template.push(
        { type: "separator" },
        {
          label: "Salvar credencial deste site…",
          enabled: Boolean(status.origin),
          click: () => void saveCurrentCredential(),
        },
        {
          label: "Importar senhas de CSV…",
          click: () => void importPasswordCsv(),
        },
        {
          label: "Sincronizar com Bitwarden…",
          click: () => void syncBitwardenIntoVault(),
        },
      );
      if (matches.length) {
        template.push({
          label: "Excluir credencial deste site",
          submenu: matches.map((entry) => ({
            label: safeLabel(entry.username),
            click: () => {
              void dialog
                .showMessageBox(win, {
                  type: "warning",
                  title: "Excluir credencial",
                  message: `Excluir a credencial de ${safeLabel(entry.username)}?`,
                  detail: entry.origin,
                  buttons: ["Excluir", "Cancelar"],
                  defaultId: 1,
                  cancelId: 1,
                  noLink: true,
                })
                .then((answer) => {
                  if (answer.response !== 0) return;
                  passwordVault.remove(entry.id);
                  pushBrowserToolbarState();
                });
            },
          })),
        });
      }
      if (status.total) {
        template.push(
          { type: "separator" },
          { label: `${status.total} credencial(is) no cofre`, enabled: false },
          {
            label: "Apagar todo o cofre…",
            click: () => {
              void dialog
                .showMessageBox(win, {
                  type: "warning",
                  title: "Apagar todo o Cofre ADR",
                  message: `Excluir permanentemente ${status.total} credencial(is)?`,
                  detail: "Esta ação não apaga o CSV original e não pode ser desfeita.",
                  buttons: ["Apagar tudo", "Cancelar"],
                  defaultId: 1,
                  cancelId: 1,
                  noLink: true,
                })
                .then((answer) => {
                  if (answer.response !== 0) return;
                  passwordVault.clear();
                  pushBrowserToolbarState();
                });
            },
          },
        );
      }
      Menu.buildFromTemplate(template).popup({ window: win });
    } catch (error) {
      await showVaultMessage(
        "error",
        "Cofre indisponível",
        error instanceof Error ? error.message : "Não foi possível abrir o Cofre ADR.",
      );
    }
  };

  handleToolbar("browser:get-appearance", () => ({ theme: appState.settings.theme }));

  handleToolbar("browser:get-vault-state", (event) => {
    if (event.sender !== browserToolbar?.webContents) return null;
    const view = withActiveBrowserView();
    return vaultStateFor(view?.webContents.getURL() || "");
  });

  handleToolbar("browser:vault-menu", (event) => {
    if (event.sender !== browserToolbar?.webContents) return { ok: false };
    void showPasswordVaultMenu();
    return { ok: true };
  });

  handleToolbar("browser:navigate", (_e, input: string, completeWww?: boolean) => {
    const view = withActiveBrowserView();
    if (!view) return { ok: false };
    const text = String(input || "");
    const target = resolveNavInput(completeWww ? completeWithWww(text) : text);
    // Digitada ou favorito: a loja nunca carrega aqui (ver isChromeWebStoreUrl).
    if (isChromeWebStoreUrl(target)) {
      openExternalServiceUrl(target);
      return { ok: true };
    }
    void view.webContents.loadURL(target);
    // Como no Chrome: depois do Enter o teclado é da página (espaço rola,
    // setas andam), não da barra.
    view.webContents.focus();
    return { ok: true };
  });

  // Esc na barra sem nada para desfazer devolve o teclado à página.
  handleToolbar("browser:focus-page", () => {
    const view = withActiveBrowserView();
    view?.webContents.focus();
    return { ok: Boolean(view) };
  });

  handleToolbar("browser:zoom-reset", () => {
    const view = withActiveBrowserView();
    if (!view) return { ok: false };
    stepPageZoom(view, 0);
    return { ok: true };
  });

  handleToolbar("browser:tab-menu", (_e, id: unknown) => {
    if (!isBrowserTab(id)) return { ok: false };
    showBrowserTabMenu(id);
    return { ok: true };
  });

  handleToolbar("browser:tab-mute", (_e, id: unknown) => {
    if (!isBrowserTab(id)) return { ok: false };
    toggleBrowserTabMute(id);
    return { ok: true };
  });

  handleToolbar("browser:back", () => {
    const view = withActiveBrowserView();
    if (!view) return { ok: false };
    if (view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack();
    return { ok: true };
  });

  handleToolbar("browser:forward", () => {
    const view = withActiveBrowserView();
    if (!view) return { ok: false };
    if (view.webContents.navigationHistory.canGoForward())
      view.webContents.navigationHistory.goForward();
    return { ok: true };
  });

  handleToolbar("browser:reload", (_e, hard?: boolean) => {
    reloadActiveSurface(Boolean(hard));
    return { ok: true };
  });

  handleToolbar("browser:stop", () => {
    const view = withActiveBrowserView();
    if (!view) return { ok: false };
    view.webContents.stop();
    return { ok: true };
  });

  handleToolbar("browser:find", (_e, text: string, forward: boolean, newSearch: boolean) => {
    const view = withActiveBrowserView();
    const query = String(text || "").slice(0, 500);
    if (!view || !query) return { ok: false };
    if (findTargetId !== null && findTargetId !== view.webContents.id) stopFind(false);
    findTargetId = view.webContents.id;
    view.webContents.findInPage(query, { forward: Boolean(forward), findNext: Boolean(newSearch) });
    return { ok: true };
  });

  handleToolbar("browser:find-stop", () => {
    stopFind(false);
    return { ok: true };
  });

  // Faixa de abas. Os ids vêm da página da barra: só valem abas do ADR Browser
  // deste workspace, e criar/fechar/mover usa o mesmo caminho da lateral.
  const isBrowserTab = (id: unknown): id is string =>
    typeof id === "string" && browserTabServices().some((s) => s.id === id);
  handleToolbar("browser:tab-activate", (_e, id: unknown) => {
    if (!isBrowserTab(id)) return { ok: false };
    showSurface(`service:${id}`, true);
    return { ok: true };
  });
  handleToolbar("browser:tab-close", (_e, id: unknown) => {
    if (!isBrowserTab(id)) return { ok: false };
    closeBrowserTab(id);
    return { ok: true };
  });
  handleToolbar("browser:tab-new", () => {
    openNewBrowserTab();
    return { ok: true };
  });
  handleToolbar("browser:tabs-reorder", (_e, orderedIds: unknown) => {
    const ids = Array.isArray(orderedIds) ? orderedIds.filter((id) => typeof id === "string") : [];
    const rail = mergeTabOrderIntoRail(
      railOrderForWorkspace(appState, workspaceId),
      browserTabServices().map((s) => s.id),
      ids,
    );
    if (!rail) {
      pushBrowserTabs(true);
      return { ok: false };
    }
    appState = reorderWorkspaceRail(appState, workspaceId, rail);
    saveAppStateAtomic(statePath, appState);
    broadcastState();
    // Fixadas ficam sempre antes (orderedServicesForWorkspace): a faixa recebe
    // a ordem que valeu, mesmo que não seja exatamente a do arrasto.
    pushBrowserTabs(true);
    return { ok: true };
  });

  handleToolbar("browser:get-url", () => {
    const view = withActiveBrowserView();
    const url = view?.webContents.getURL() || "";
    return url.startsWith("data:") ? "" : url;
  });

  const activeAdBlockState = () => {
    const view = withActiveBrowserView();
    if (!view) return null;
    return {
      ...adBlocker.stateFor(view.webContents.id, view.webContents.getURL()),
      externalBrowser: preferredBrowser(),
    };
  };

  handleToolbar("browser:get-adblock-state", () => activeAdBlockState());

  handleToolbar("browser:toggle-adblock", (_event, enabled?: boolean) => {
    appState = parseAppState({
      ...appState,
      settings: {
        ...appState.settings,
        adBlockEnabled: typeof enabled === "boolean" ? enabled : !appState.settings.adBlockEnabled,
      },
    });
    saveAppStateAtomic(statePath, appState);
    broadcastState();
    pushBrowserToolbarState();
    return activeAdBlockState();
  });

  handleToolbar("browser:toggle-site-allowlist", () => {
    const view = withActiveBrowserView();
    const hostname = hostnameFromUrl(view?.webContents.getURL() || "");
    if (!view || !hostname) return null;
    const current = new Set(appState.settings.adBlockAllowlist);
    if (current.has(hostname)) current.delete(hostname);
    else current.add(hostname);
    appState = parseAppState({
      ...appState,
      settings: { ...appState.settings, adBlockAllowlist: [...current] },
    });
    saveAppStateAtomic(statePath, appState);
    broadcastState();
    pushBrowserToolbarState();
    return activeAdBlockState();
  });

  handleToolbar("browser:open-external", async () => {
    const view = withActiveBrowserView();
    const url = view?.webContents.getURL();
    const target =
      url && !url.startsWith("data:") && isAllowedExternalUrl(url)
        ? url
        : "https://www.google.com/";
    return openInPreferredBrowser(target, preferredBrowser());
  });

  handleToolbar("browser:lusha-search", async () => {
    const view = withActiveBrowserView();
    const currentUrl = view?.webContents.getURL() || "";
    const linkedinUrl = normalizeLinkedInProfileUrl(currentUrl);
    if (!linkedinUrl) {
      showToast("Abra um perfil /in/ do LinkedIn no ADR Browser.");
      return { ok: false, code: "LINKEDIN_PROFILE_REQUIRED" };
    }
    if (!view) return { ok: false, code: "NO_ACTIVE_VIEW" };
    const requestWorkspaceId = workspaceId;
    /**
     * Card no mundo isolado, e só se a aba ainda está no MESMO perfil: entre uma
     * etapa e outra há consulta ao CRM, e a página pode ter navegado — o card
     * revelado caía na página nova, de outra origem.
     */
    const showLushaCard = async (script: string): Promise<unknown> => {
      if (view.webContents.isDestroyed()) return "close";
      if (normalizeLinkedInProfileUrl(view.webContents.getURL()) !== linkedinUrl) return "close";
      return view.webContents.executeJavaScriptInIsolatedWorld(LUSHA_WORLD_ID, [{ code: script }]);
    };
    try {
      // Todas as etapas na sessão do workspace onde a consulta começou: o card
      // espera clique do usuário entre elas, e trocar de workspace nesse meio
      // fazia o "Revelar" gastar créditos Lusha na conta do outro CRM.
      const searchResponse = await callCrmLusha(
        { action: "search", linkedinUrl },
        requestWorkspaceId,
      );
      const result = searchResponse["result"] as { id?: unknown; preview?: unknown } | null;
      if (!searchResponse["found"] || !result?.preview) {
        await showLushaCard(
            buildLushaCardScript("message", {
              title: "Nenhum contato encontrado",
              message: "A Lusha não encontrou um contato para este perfil.",
            }),
          )
          .catch(() => undefined);
        return { ok: true, found: false };
      }
      const previewData = parseLushaContact(result.preview);
      const contactId = typeof result.id === "string" ? result.id : "";
      if (!contactId) {
        await showLushaCard(
            buildLushaCardScript("preview", {
              ...previewData,
              hasContactId: false,
            }),
          )
          .catch(() => undefined);
        return { ok: true, found: true, enriched: false };
      }
      const action = await showLushaCard(
          buildLushaCardScript("preview", {
            ...previewData,
            hasContactId: true,
          }),
        )
        .catch(() => "close");
      if (action !== "reveal") return { ok: true, found: true, enriched: false };
      const enrichResponse = await callCrmLusha(
        { action: "enrich", contactId, reveal: ["emails", "phones"] },
        requestWorkspaceId,
      );
      const enrichedData = parseLushaContact(enrichResponse["result"]) || {
        fullName: previewData?.fullName || null,
        jobTitle: previewData?.jobTitle || null,
        companyName: previewData?.companyName || null,
        linkedinUrl: previewData?.linkedinUrl || linkedinUrl,
        emails: [],
        phones: [],
        canRevealSummary: null,
        hasContactId: false,
      };
      enrichedData.linkedinUrl ||= linkedinUrl;
      const revealedAction = await showLushaCard(buildLushaCardScript("revealed", enrichedData))
        .catch(() => "close");
      if (revealedAction !== "prepareDeal") return { ok: true, found: true, enriched: true };
      const prepared = await callCrmLusha(
        {
          action: "prepareDeal",
          contact: {
            fullName: enrichedData.fullName,
            jobTitle: enrichedData.jobTitle,
            companyName: enrichedData.companyName,
            linkedinUrl: enrichedData.linkedinUrl || linkedinUrl,
            emails: enrichedData.emails,
            phones: enrichedData.phones,
          },
        },
        requestWorkspaceId,
      );
      const href = typeof prepared["href"] === "string" ? prepared["href"] : "";
      if (!href || !activateWorkspace(requestWorkspaceId)) throw new Error("Preparação inválida.");
      showSurface("crm");
      openCrmPath(href);
      return { ok: true, found: true, enriched: true, prepared: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Não foi possível consultar a Lusha.";
      await showLushaCard(
          buildLushaCardScript("message", {
            title: "Falha na consulta Lusha",
            message: `${message}\nVerifique os créditos, a permissão da API e a URL do perfil.`,
          }),
        )
        .catch(() => undefined);
      return { ok: false, code: "LUSHA_UPSTREAM_ERROR" };
    }
  });

  handleShell("shell:downloads", () => downloads.list());

  handleShell("shell:download-cancel", (_e, id: string) => {
    return { ok: downloads.cancel(String(id || "")) };
  });

  handleShell(
    "shell:open-external-browser",
    async (_e, url?: string, prefer?: "chrome" | "brave" | "auto") => {
      const view = activeServiceView();
      const candidate =
        (url && String(url)) || view?.webContents.getURL() || "https://www.google.com/";
      const target = isAllowedExternalUrl(candidate) ? candidate : "https://www.google.com/";
      return openInPreferredBrowser(target, prefer || preferredBrowser());
    },
  );

  handleShell("shell:export-diagnostics", () => {
    const snapshot = buildDiagnosticSnapshot({
      settings: {
        theme: appState.settings.theme,
        uiScale: appState.settings.uiScale,
        maxLoadedViews: appState.settings.maxLoadedViews,
      },
      services: appState.services
        .filter((s) => !s.deletedAt)
        .map((s) => ({ id: s.id, kind: s.kind, name: s.name, keepAwake: s.keepAwake })),
      recentLogs,
    });
    const file = writeDiagnosticExport(snapshot);
    pushLog("info", "diagnostics exported", file);
    return { ok: true, file };
  });

  /**
   * Grava cookie e DOMStorage em disco. O Chromium só faz isso de tempos em
   * tempos; quem fecha antes perde o login feito na sessão.
   *
   * Partições, não views: serviço hibernado (10 min de inatividade) não tem
   * webContents, então a lista de views deixava a sessão dele de fora e o
   * cookie nunca era gravado.
   */
  const flushSessions = async (): Promise<void> => {
    // Síncrono e primeiro: quem chama isto está saindo (before-quit, fim de
    // sessão do Windows, instalar atualização).
    flushStateSave();
    browserHistory.flush();
    const sessions = new Set([
      ...webContents.getAllWebContents().map((wc) => wc.session),
      ...appState.profiles.map((profile) => session.fromPartition(profile.partitionName)),
      ...appState.workspaces.map((ws) => session.fromPartition(crmLoginPartition(ws.id))),
    ]);
    await Promise.all(
      [...sessions].map((current) =>
        Promise.resolve()
          // flushStorageData é só DOMStorage; o login vem em cookie.
          .then(() => current.cookies.flushStore())
          .then(() => current.flushStorageData())
          .catch(() => undefined),
      ),
    );
  };
  opts.setFlushSessions(flushSessions);
  // Reiniciar o Windows não emite before-quit (documentado: "on Windows, this
  // event will not be emitted if the app is closed due to a shutdown/restart of
  // the system or a user logout"). Era exatamente o buraco do "perco o login do
  // Spotify a cada reboot": fechar o app gravava, reiniciar a máquina não.
  // Os dois eventos que sobram: query-session-end avisa antes (dá mais tempo até
  // o SO matar o processo) e session-end quando já não dá para cancelar. Chamar
  // duas vezes é inofensivo — flushStore é idempotente.
  const flushOnSessionEnd = (): void => {
    void flushSessions();
  };
  win.on("query-session-end", flushOnSessionEnd);
  win.on("session-end", flushOnSessionEnd);

  /**
   * O instalador que o electron-updater já baixou e validou (sha512 conferido por
   * ele). `@adrdesktop-updater` é o `updaterCacheDirName` do build — se mudar lá,
   * muda aqui; por isso o caminho é conferido antes de ser usado.
   */
  const pendingUpdateInstaller = (): string | null => {
    const localAppData = process.env["LOCALAPPDATA"];
    if (process.platform !== "win32" || !localAppData) return null;
    const dir = path.join(localAppData, "@adrdesktop-updater", "pending");
    try {
      const info = JSON.parse(fs.readFileSync(path.join(dir, "update-info.json"), "utf8")) as {
        fileName?: unknown;
      };
      if (typeof info.fileName !== "string" || !info.fileName) return null;
      // basename: o nome vem de um arquivo em disco, mas nunca custa impedir que
      // ele aponte para fora da pasta de pendências.
      const file = path.join(dir, path.basename(info.fileName));
      return fs.existsSync(file) ? file : null;
    } catch {
      return null;
    }
  };

  const desktopUpdater = new DesktopUpdater((next) => {
    const previousPhase = updateState.phase;
    updateState = next;
    broadcastState();
    // A mensagem mostrada ao usuário é genérica de propósito (safeUpdaterError);
    // sem registrar a fase aqui, uma falha de update não deixava rastro nenhum
    // no diagnóstico — e "não aconteceu nada" vira impossível de investigar.
    if (next.phase === "error" && previousPhase !== "error") {
      pushLog("error", "update", { version: next.latestVersion, message: next.message });
    }
    if (next.phase === "downloaded" && previousPhase !== "downloaded") {
      notify(`${next.message}. Instala sozinha quando o app ficar ocioso — ou agora, em Configurações.`);
      installUpdateWhenIdle();
    }
  });

  /**
   * Atualização baixada não reinicia o app no meio do uso — ligação no
   * WhatsApp, vídeo, download. Antes ela instalava na hora em que terminava de
   * baixar. Espera ninguém estar olhando (minimizado/escondido) ou 5 min sem
   * teclado e mouse, com nada tocando nem baixando. O botão de instalar das
   * Configurações continua imediato.
   */
  let updateIdleTimer: NodeJS.Timeout | undefined;
  function installUpdateWhenIdle(): void {
    // Sair antes de ficar ocioso também instala (ver DesktopUpdater.installOnQuit).
    desktopUpdater.installOnQuit();
    clearInterval(updateIdleTimer);
    updateIdleTimer = setInterval(() => {
      if (updateState.phase !== "downloaded" || win.isDestroyed()) {
        clearInterval(updateIdleTimer);
        return;
      }
      let systemIdleSeconds = 0;
      try {
        systemIdleSeconds = powerMonitor.getSystemIdleTime();
      } catch {
        /* sem leitura: conta só a janela */
      }
      // Computador parado há 5 min, não só a janela minimizada: o app reabre
      // maximizado depois de atualizar, e com a pessoa trabalhando em outra
      // janela (ou apresentando a tela) ele saltava por cima com as conversas.
      const ready = canInstallUpdateNow({
        systemIdleSeconds,
        now: Date.now(),
        lastAudibleAt,
        audibleNow: webContents.getAllWebContents().some((wc) => !wc.isDestroyed() && wc.isCurrentlyAudible()),
        inMeetCall: meet.anyCall(),
        downloading: downloads.list().some((download) => download.state === "progressing"),
      });
      if (!ready) return;
      clearInterval(updateIdleTimer);
      pushLog("info", "update install when idle", { version: updateState.latestVersion });
      void installDownloadedUpdate();
    }, 60_000);
  }
  win.on("closed", () => clearInterval(updateIdleTimer));
  updateState = desktopUpdater.snapshot();

  const installDownloadedUpdate = async (): Promise<{ ok: boolean; message: string }> => {
    const result = await desktopUpdater.install(
      async () => {
        saveAppStateAtomic(statePath, appState);
        await flushSessions();
      },
      () => {
        // O pacote já foi baixado e conferido; se o updater não encerrar o app,
        // abre o instalador para concluir atualização obrigatória.
        const installer = pendingUpdateInstaller();
        pushLog("error", "install nao iniciou", { fallback: Boolean(installer) });
        if (!installer) {
          showToast("Não foi possível iniciar a atualização. Exporte o diagnóstico.");
          return;
        }
        showToast("Reinício não iniciou; abrindo instalador.");
        void shell.openPath(installer);
      },
    );
    if (!result.ok) showToast(result.message);
    return result;
  };

  handleShell("shell:check-updates", async (event) => {
    if (
      event.sender !== panel.webContents &&
      event.sender !== shellView.webContents &&
      event.sender !== overlay.webContents
    ) {
      return { ...updateState, phase: "error", message: "Origem não autorizada" };
    }
    const result = await desktopUpdater.check(true);
    pushLog("info", "update check", { phase: result.phase, version: result.latestVersion });
    return result;
  });

  handleShell("shell:install-update", async (event) => {
    if (event.sender !== panel.webContents) {
      return { ok: false, message: "Origem não autorizada" };
    }
    return installDownloadedUpdate();
  });

  // Sem sessão CRM: mostra o login. Com sessão: primeiro serviço, sem criar o
  // renderer do CRM (~400–700 MB) só para escondê-lo em seguida.
  let revealed = false;
  const reveal = (): void => {
    if (revealed || win.isDestroyed()) return;
    revealed = true;
    layout();
    win.maximize();
    win.show();
    broadcastState();
    showQuarantineNotice();
  };
  const revealTimer = setTimeout(reveal, 2000);
  // O resultado é do workspace do boot: se o usuário trocou antes de a consulta
  // voltar, ele não vale para o workspace atual.
  const bootWorkspaceId = workspaceId;
  void crmSessionHasLogin(bootWorkspaceId)
    .then((loggedIn) => {
      if (win.isDestroyed()) return;
      if (loggedIn) crmAuthenticatedWorkspaces.add(bootWorkspaceId);
      else crmAuthenticatedWorkspaces.delete(bootWorkspaceId);
      crmLoginKnown.add(bootWorkspaceId);
      if (workspaceId !== bootWorkspaceId) {
        reveal();
        return;
      }
      if (loggedIn) {
        const first = shellStatePayload().services[0];
        showSurface(first ? `service:${first.id}` : "empty");
      } else {
        showSurface("crm");
      }
      armCrmGate(workspaceId);
      reveal();
    })
    .catch(() => {
      if (win.isDestroyed()) return;
      showSurface("crm");
      armCrmGate(workspaceId);
      reveal();
    });
  desktopUpdater.start();
  win.on("closed", () => {
    desktopUpdater.dispose();
    if (crmGateTimer) clearInterval(crmGateTimer);
    clearInterval(hibernationTimer);
    clearInterval(privacyTimer);
    clearTimeout(toastTimer);
    clearTimeout(adBlockToolbarTimer);
    clearTimeout(revealTimer);
    for (const timer of crmRetryTimers.values()) clearTimeout(timer);
    crmRetryTimers.clear();
  });
}
