import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createPermissionHandler } from "./permission-handler.js";
import { describe, expect, it, vi } from "vitest";
import { validateCrmIpcRequest, viewKindAllowsCrmPreload } from "@adr/crm-desktop-adapter";
import { normalizeTranscribeResult } from "@adr/crm-core";
import { latestWhatsAppActivity, whatsappLockExpired } from "./whatsapp-lock.js";
import { browserRestoreUrl } from "./service-navigation.js";
import { CrmTranscriptCache } from "./crm-transcript-cache.js";
import { openWhatsAppNotificationChatScript } from "./notifications.js";

// Execute the actual closure bodies with fake Electron ports, not copied algorithms.
// This covers orchestration in the large window module without opening user sessions.
const windowSource = fs.readFileSync(new URL("./workspace-window.ts", import.meta.url), "utf8");
const mainSource = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8");
// Um parse por arquivo: reparsear as ~5.800 linhas a cada função custava
// centenas de ms por teste.
const parsed = new Map<string, ts.SourceFile>();
function find(source: string, predicate: (node: ts.Node) => boolean): ts.Node {
  let ast = parsed.get(source);
  if (!ast) {
    ast = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
    parsed.set(source, ast);
  }
  let result: ts.Node | undefined;
  function walk(node: ts.Node): void {
    if (!result && predicate(node)) result = node;
    ts.forEachChild(node, walk);
  }
  walk(ast);
  if (!result) throw new Error("Runtime source node not found");
  return result;
}
function evaluate(code: string, globals: Record<string, unknown>) {
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return vm.runInNewContext(js, globals);
}
function runtimeFunction(name: string, globals: Record<string, unknown>, source = windowSource) {
  const node = find(
    source,
    (n) =>
      (ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n)) && n.name?.getText() === name,
  );
  const declaration = (ts.isVariableDeclaration(node) ? "const " : "") + node.getText();
  return evaluate(`${declaration};\n${name}`, globals);
}
const no = () => undefined;

function privacyFixture() {
  const clock = { now: 10_000, idle: 0, focused: true };
  const globals = {
    Date: { now: () => clock.now },
    win: { isDestroyed: () => false, isFocused: () => clock.focused },
    nobodyWatching: () => false,
    powerMonitor: { getSystemIdleTime: () => clock.idle },
    whatsappUnlocked: new Set(["wa-A"]),
    whatsappLastActive: new Map([["wa-A", clock.now]]),
    isWhatsAppLocked: () => true,
    lockTimeoutMs: () => 300_000,
    lockTimeoutMinutes: () => 5,
    whatsappLockExpired,
    latestWhatsAppActivity,
    activeSurface: "service:wa-A",
    showToast: no,
    broadcastState: no,
    closeServiceDevTools: no,
  };
  return { clock, globals, refresh: runtimeFunction("refreshWhatsAppPrivacy", globals) };
}

describe("window orchestration regressions", () => {
  it.each(["1234", null])(
    "aguarda o PIN antes de navegar pela notificação (PIN: %s)",
    async (pin) => {
      const service = { id: "wa-A", kind: "whatsapp", workspaceId: "A", name: "Teste" };
      const executeJavaScript = vi.fn(async () => true);
      let reply!: (value: string | null) => void;
      const globals = {
        pendingNotificationChats: new Map([[service.id, "Ana Silva"]]),
        appState: {
          services: [service],
          activeServiceId: service.id,
          settings: { whatsappLockOnLeaveServiceIds: {} },
        },
        activateWorkspace: () => true,
        crmSurfaceAllowedWithoutLogin: () => false,
        crmAuthenticatedWorkspaces: new Set(["A"]),
        workspaceId: "A",
        activeSurface: "settings",
        isWhatsAppLocked: () => true,
        whatsappUnlocked: new Set(),
        whatsappLastActive: new Map(),
        lockTimeoutMs: () => 300_000,
        whatsappLockExpired,
        whatsappUnlockPromptOpen: false,
        pinThrottle: { remainingLockoutMs: () => 0 },
        whatsappLockFor: () => ({ throttleKey: "wa-A", pinState: () => "ok" }),
        askPin: () =>
          new Promise<string | null>((resolve) => {
            reply = resolve;
          }),
        verifyWhatsAppPin: () => ({ ok: true }),
        activeService: () => undefined,
        layout: no,
        broadcastState: no,
        showToast: no,
        focusActiveSurface: no,
        lastUsedAt: new Map(),
        trayDismissed: false,
        refreshTrayBadge: no,
        serviceViews: new Map([[service.id, { webContents: { executeJavaScript } }]]),
        openWhatsAppNotificationChatScript,
        enforceHibernation: async () => undefined,
        shellView: { webContents: { send: no } },
      };
      const show = runtimeFunction("showSurface", globals);
      show("service:wa-A");
      expect(executeJavaScript).not.toHaveBeenCalled();
      reply(pin);
      // Espera o efeito, não um número fixo de microtarefas (um await a mais em
      // showSurface quebrava o teste sem quebrar o app).
      await vi.waitFor(() => expect(globals.pendingNotificationChats.size).toBe(0));
      expect(executeJavaScript).toHaveBeenCalledTimes(pin ? 1 : 0);
      expect(globals.pendingNotificationChats.size).toBe(0);
      expect(globals.activeSurface).toBe(pin ? "service:wa-A" : "settings");
    },
  );

  it("nega notificações CRM da página e do service worker mesmo com concessão antiga", () => {
    let request!: (
      contents: { getURL: () => string },
      permission: string,
      callback: (allowed: boolean) => void,
      details: object,
    ) => void;
    let check!: (contents: null, permission: string, origin: string, details: object) => boolean;
    const ses = {
      setPermissionRequestHandler: (fn: typeof request) => {
        request = fn;
      },
      setPermissionCheckHandler: (fn: typeof check) => {
        check = fn;
      },
    };
    // A política saiu de workspace-window.ts (permission-handler.ts): o teste usa
    // o módulo de verdade, com as dependências que a janela passa.
    const { attach } = createPermissionHandler({
      parentWindow: {} as never,
      viewMeta: new WeakMap(),
      isCrmUrl: (url: string) => new URL(url).origin === "https://app.adragencia.com.br",
      crmSurfaceId: "crm",
      notificationSettings: () => ({ enabled: true, serviceEnabled: { crm: true } }) as never,
      isServiceOwnSite: () => false,
      pageMayOpen: () => true,
      rememberedPermission: () => true,
      rememberPermission: () => undefined,
      serviceOfOrigin: () => undefined,
      meetingQuietFor: () => false,
      log: () => undefined,
    });
    attach(ses as never, "persist:crm-A", "crm", "crm", () => "https://app.adragencia.com.br/");
    const callback = vi.fn();
    request({ getURL: () => "https://app.adragencia.com.br/" }, "notifications", callback, {});
    expect(callback).toHaveBeenCalledWith(false);
    expect(check(null, "notifications", "https://app.adragencia.com.br", {})).toBe(false);
  });

  it("relocks a visible idle WhatsApp and hides it before layout restores content", () => {
    const { clock, globals, refresh } = privacyFixture();
    clock.now += 3_600_000;
    clock.idle = 3600;
    expect(refresh()).toBe(true);
    expect(globals.whatsappUnlocked.has("wa-A")).toBe(false);
    expect(globals.activeSurface).toBe("settings");
    const layout = find(
      windowSource,
      (n) => ts.isVariableDeclaration(n) && n.name.getText() === "layout",
    );
    expect(layout.getText().indexOf("refreshWhatsAppPrivacy()")).toBeLessThan(
      layout.getText().indexOf("place(view"),
    );
  });

  it("keeps an actively used account unlocked, but input in another app does not refresh it", () => {
    const { clock, globals, refresh } = privacyFixture();
    for (let second = 0; second < 600; second++) {
      clock.now += 1000;
      refresh();
    }
    expect(globals.whatsappUnlocked.has("wa-A")).toBe(true);
    clock.focused = false;
    clock.now += 300_000;
    refresh();
    expect(globals.whatsappUnlocked.has("wa-A")).toBe(false);
  });

  it("does not treat new input after sleep as permission to unlock an expired account", () => {
    const { clock, globals, refresh } = privacyFixture();
    clock.now += 600_000;
    clock.idle = 0;
    refresh();
    expect(globals.whatsappUnlocked.has("wa-A")).toBe(false);
  });

  it("binds recreated views to the service workspace rather than the selected window workspace", () => {
    const viewMeta = new WeakMap();
    const contents = {};
    const registration = find(
      windowSource,
      (n) =>
        ts.isExpressionStatement(n) &&
        n.getText().startsWith("opts.viewMeta.set(view.webContents,") &&
        n.getText().includes("svc.kind"),
    );
    evaluate(registration.getText(), {
      opts: { viewMeta },
      view: { webContents: contents },
      workspaceId: "B",
      svc: { id: "wa-A", workspaceId: "A", kind: "whatsapp" },
    });
    expect(viewMeta.get(contents)).toEqual({
      kind: "whatsapp",
      serviceId: "wa-A",
      workspaceId: "A",
    });
  });

  it("loads the saved browser page, or restores its back/forward history", () => {
    const loadURL = vi.fn(async () => undefined);
    const restore = vi.fn(async () => undefined);
    const globals = {
      needsInitialLoad: new Set(["browser-A"]),
      serviceViews: new Map([
        [
          "browser-A",
          {
            getBounds: () => ({ width: 1000, height: 800 }),
            webContents: { setBackgroundThrottling: no, loadURL, navigationHistory: { restore } },
          },
        ],
      ]),
      appState: {
        services: [{ id: "browser-A", kind: "browser", startUrl: "https://example.org/start" }],
      },
      suspendedBrowserUrls: new Map([["browser-A", "https://example.org/current"]]),
      suspendedBrowserHistory: new Map(),
      pendingServiceUrls: new Map<string, { url: string; at: number }>(),
      browserRestoreUrl,
      setTimeout: no,
    };
    const ensureLoaded = runtimeFunction("ensureServiceLoaded", globals);
    ensureLoaded("browser-A");
    expect(loadURL).toHaveBeenCalledWith("https://example.org/current");
    const history = {
      entries: [{ url: "https://example.org/current", title: "Current" }],
      index: 0,
    };
    globals.suspendedBrowserHistory.set("browser-A", history);
    globals.needsInitialLoad.add("browser-A");
    ensureLoaded("browser-A");
    expect(restore).toHaveBeenCalledWith(history);
    expect(globals.suspendedBrowserHistory.has("browser-A")).toBe(false);
    // Link aberto de fora (convite do Meet): a primeira carga usa a URL pendente,
    // uma vez só, no lugar da home e do histórico.
    globals.pendingServiceUrls.set("browser-A", { url: "https://example.org/convite", at: Date.now() });
    globals.suspendedBrowserHistory.set("browser-A", history);
    globals.needsInitialLoad.add("browser-A");
    restore.mockClear();
    ensureLoaded("browser-A");
    expect(loadURL).toHaveBeenLastCalledWith("https://example.org/convite");
    expect(restore).not.toHaveBeenCalled();
    expect(globals.pendingServiceUrls.has("browser-A")).toBe(false);
    // Pedido de mais de 1 min: não reabre o convite velho; volta ao histórico.
    globals.pendingServiceUrls.set("browser-A", { url: "https://example.org/velho", at: Date.now() - 61_000 });
    globals.suspendedBrowserHistory.set("browser-A", history);
    globals.needsInitialLoad.add("browser-A");
    loadURL.mockClear();
    ensureLoaded("browser-A");
    expect(restore).toHaveBeenCalledWith(history);
    expect(loadURL).not.toHaveBeenCalledWith("https://example.org/velho");
  });

  it("does not create the CRM renderer at window boot", () => {
    const closeIdx = windowSource.indexOf("const closeInactiveCrmViews");
    const servicesIdx = windowSource.indexOf("const serviceViews = new Map");
    expect(closeIdx).toBeGreaterThan(0);
    expect(servicesIdx).toBeGreaterThan(closeIdx);
    expect(windowSource.slice(closeIdx, servicesIdx)).not.toContain("ensureCrmView(workspaceId)");
    // Hibernação do CRM (ociosidade e LRU como uma aba só): hibernation.test.ts.
    expect(windowSource).toContain("closeAllConnections()");
    expect(windowSource).toContain("15_000");
    expect(windowSource).toContain('ses.cookies.on("changed"');
    expect(windowSource).not.toContain("Atualização CRM: agora é possível desligar autoenvio");
    expect(windowSource).toContain("const revealTimer = setTimeout(reveal, 2000)");
  });
});

describe("CRM IPC orchestration", () => {
  it("rejects cross-scope IPC and never serves a transcription without an authenticated API call", async () => {
    // Frame principal explícito: sem frame o pedido é recusado (frame nulo não
    // conta como frame de topo — ver handleCrmCommand).
    const mainFrame = { url: "https://web.whatsapp.com/" };
    const sender = { getURL: () => "https://web.whatsapp.com/", mainFrame };
    const viewMeta = new WeakMap([[sender, { kind: "whatsapp", workspaceId: "A" }]]);
    const transcriptCache = new CrmTranscriptCache(async () => ({
      hasCrm: true,
      scope: "tenant:A",
    }));
    const callCrmJson = vi.fn(async () => ({ status: "completed", text: "server authorized" }));
    const handle = runtimeFunction(
      "handleCrmCommand",
      {
        viewMeta,
        transcriptCache,
        validateCrmIpcRequest,
        viewKindAllowsCrmPreload,
        callCrmJson,
        normalizeTranscribeResult,
        AbortSignal,
      },
      mainSource,
    );
    await expect(
      handle("getTranscriptCache", { scope: "tenant:B" }, sender, mainFrame),
    ).rejects.toMatchObject({ status: 403 });
    // Frame nulo (navegou/morreu antes de o handler ler) não passa como topo.
    await expect(handle("whoami", {}, sender, null)).rejects.toThrow("Frame não autorizado");
    await handle(
      "cacheTranscript",
      { scope: "tenant:A", externalId: "msg", text: "cached text" },
      sender,
      mainFrame,
    );
    expect(
      await handle("transcribeMessage", { externalId: "msg" }, sender, mainFrame),
    ).toMatchObject({
      text: "server authorized",
    });
    expect(callCrmJson).toHaveBeenCalledOnce();
    callCrmJson.mockRejectedValueOnce(Object.assign(new Error("signed out"), { status: 401 }));
    await expect(
      handle("transcribeMessage", { externalId: "msg" }, sender, mainFrame),
    ).rejects.toMatchObject({
      status: 401,
    });
  });
});
