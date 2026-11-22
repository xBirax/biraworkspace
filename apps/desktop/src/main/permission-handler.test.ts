import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  fromWebContents: vi.fn(),
}));
vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: electron.fromWebContents },
  dialog: { showMessageBox: electron.showMessageBox },
}));

import { createPermissionHandler, type PermissionHandlerDeps } from "./permission-handler.js";

type RequestFn = (
  contents: unknown,
  permission: string,
  callback: (allowed: boolean) => void,
  details?: Record<string, unknown>,
) => void;
type CheckFn = (contents: unknown, permission: string, origin: string, details?: Record<string, unknown>) => boolean;

const WA = "https://web.whatsapp.com";

function setup(overrides: Partial<PermissionHandlerDeps> = {}, grants: Record<string, boolean> = {}) {
  let request!: RequestFn;
  let check!: CheckFn;
  const ses = {
    setPermissionRequestHandler: (fn: RequestFn) => (request = fn),
    setPermissionCheckHandler: (fn: CheckFn) => (check = fn),
  };
  const remembered: string[] = [];
  const viewMeta = new WeakMap<object, { kind: string; workspaceId: string; serviceId?: string }>();
  const handler = createPermissionHandler({
    parentWindow: {} as never,
    viewMeta: viewMeta as never,
    isCrmUrl: () => false,
    crmSurfaceId: "crm",
    notificationSettings: () => ({ enabled: true, serviceEnabled: {} }) as never,
    isServiceOwnSite: () => false,
    pageMayOpen: () => true,
    rememberedPermission: (origin, permission) => grants[`${origin}|${permission}`],
    rememberPermission: (origin, permission) => remembered.push(`${origin}|${permission}`),
    serviceOfOrigin: () => undefined,
    meetingQuietFor: () => false,
    log: () => undefined,
    ...overrides,
  });
  handler.attach(ses as never, "persist:whatsapp-A", "whatsapp", "wa-1", () => `${WA}/`);
  const page = { getURL: () => `${WA}/` };
  const ask = (permission: string, details: Record<string, unknown> = {}, contents: object = page) =>
    new Promise<boolean>((resolve) => request(contents, permission, resolve, { requestingUrl: `${WA}/`, ...details }));
  return { handler, ses, ask, check: (...args: Parameters<CheckFn>) => check(...args), remembered, viewMeta, page };
}

beforeEach(() => {
  electron.showMessageBox.mockReset();
  electron.fromWebContents.mockReset();
});

describe("createPermissionHandler", () => {
  it("'Apresentar agora' (media sem tipo) vai pela regra de captura de tela, sem diálogo", async () => {
    const { ask } = setup();
    await expect(ask("media", { mediaTypes: [] })).resolves.toBe(true);
    expect(electron.showMessageBox).not.toHaveBeenCalled();
  });

  it("'media' lembrado antes da separação (0.1.49) libera o microfone sem perguntar", async () => {
    const { ask } = setup({}, { [`${WA}|media`]: true });
    await expect(ask("media", { mediaTypes: ["audio"] })).resolves.toBe(true);
    expect(electron.showMessageBox).not.toHaveBeenCalled();
  });

  it("'Permitir' grava só o microfone; 'Negar' não grava nada; diálogo com erro nega", async () => {
    const allow = setup();
    electron.showMessageBox.mockResolvedValueOnce({ response: 1 });
    await expect(allow.ask("media", { mediaTypes: ["audio"] })).resolves.toBe(true);
    expect(allow.remembered).toEqual([`${WA}|media:audio`]);

    const deny = setup();
    electron.showMessageBox.mockResolvedValueOnce({ response: 0 });
    await expect(deny.ask("media", { mediaTypes: ["audio"] })).resolves.toBe(false);
    expect(deny.remembered).toEqual([]);

    const broken = setup();
    electron.showMessageBox.mockRejectedValueOnce(new Error("janela fechada"));
    await expect(broken.ask("media", { mediaTypes: ["video"] })).resolves.toBe(false);
    expect(broken.remembered).toEqual([]);
  });

  it("protocolo externo pedido por aba no fundo é negado sem abrir diálogo", async () => {
    const { ask, viewMeta, page } = setup({ pageMayOpen: () => false });
    viewMeta.set(page, { kind: "whatsapp", workspaceId: "A", serviceId: "wa-1" });
    await expect(ask("openExternal", { externalURL: "ms-msdt:x" })).resolves.toBe(false);
    expect(electron.showMessageBox).not.toHaveBeenCalled();
  });

  it("em sessão compartilhada, quem pede (viewMeta) decide a regra, não o último serviço criado", async () => {
    // A sessão foi criada como WhatsApp (pode microfone), mas quem pede é o Gmail.
    const { ask, viewMeta } = setup();
    const gmail = { getURL: () => "https://mail.google.com/" };
    viewMeta.set(gmail, { kind: "gmail", workspaceId: "A", serviceId: "gm-1" });
    await expect(
      ask("media", { mediaTypes: ["audio"], requestingUrl: "https://mail.google.com/" }, gmail),
    ).resolves.toBe(false);
    expect(electron.showMessageBox).not.toHaveBeenCalled();
  });

  it.each(["audio", "video"])("Teams pode pedir %s mesmo com Outlook na mesma sessão", async (mediaType) => {
    const origin = "https://outlook.office.com";
    const { handler, ses, ask, check, viewMeta, remembered } = setup();
    handler.attach(ses as never, "persist:ms-A", "outlook", "outlook-1", () => `${origin}/`);
    const teams = { getURL: () => "https://teams.cloud.microsoft/" };
    viewMeta.set(teams, { kind: "teams", workspaceId: "A", serviceId: "teams-1" });

    // O check precisa deixar o pedido chegar ao diálogo, inclusive num iframe do calendário.
    expect(check(teams, "media", origin, { requestingUrl: `${origin}/`, mediaType })).toBe(true);
    electron.showMessageBox.mockResolvedValueOnce({ response: 1 });
    await expect(ask("media", { requestingUrl: `${origin}/`, mediaTypes: [mediaType] }, teams)).resolves.toBe(true);
    expect(electron.showMessageBox).toHaveBeenCalledOnce();
    expect(remembered).toEqual([`${origin}|media:${mediaType}`]);
  });

  it("notificação de service worker (sem webContents) respeita o 'não perturbe' da reunião", () => {
    const quiet = setup({
      serviceOfOrigin: () => ({ id: "wa-1", kind: "whatsapp" }),
      meetingQuietFor: (id) => id === "wa-1",
      isServiceOwnSite: () => true,
    });
    expect(quiet.check(null, "notifications", WA, {})).toBe(false);

    const free = setup({
      serviceOfOrigin: () => ({ id: "wa-1", kind: "whatsapp" }),
      isServiceOwnSite: () => true,
    });
    expect(free.check(null, "notifications", WA, {})).toBe(true);
  });

  it("horário silencioso cala só o service worker; a página não lê 'bloqueado'", () => {
    const hour = new Date().getHours();
    const quietNow = {
      enabled: true,
      serviceEnabled: {},
      quietHours: true,
      quietFromHour: hour,
      quietToHour: (hour + 1) % 24,
    };
    const { check, viewMeta, page } = setup({
      notificationSettings: () => quietNow as never,
      serviceOfOrigin: () => ({ id: "wa-1", kind: "whatsapp" }),
      isServiceOwnSite: () => true,
    });
    viewMeta.set(page, { kind: "whatsapp", workspaceId: "A", serviceId: "wa-1" });
    expect(check(page as never, "notifications", WA, {})).toBe(true);
    expect(check(null, "notifications", WA, {})).toBe(false);
  });

  it("isAttached só reconhece sessões que receberam a política", () => {
    const { handler, ses } = setup();
    expect(handler.isAttached(ses as never)).toBe(true);
    expect(handler.isAttached({} as never)).toBe(false);
  });
});
