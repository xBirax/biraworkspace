import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  notifications: [] as Array<{ options: { title: string; body?: string }; click: () => void }>,
  register: vi.fn(() => true),
  unregister: vi.fn(),
}));
vi.mock("electron", () => {
  class FakeNotification {
    static isSupported = () => true;
    private handlers: Record<string, () => void> = {};
    constructor(options: { title: string; body?: string }) {
      electron.notifications.push({ options, click: () => this.handlers["click"]?.() });
    }
    on(name: string, fn: () => void) {
      this.handlers[name] = fn;
    }
    show() {}
  }
  return {
    Menu: { buildFromTemplate: () => ({ popup: () => undefined }) },
    Notification: FakeNotification,
    globalShortcut: { register: electron.register, unregister: electron.unregister },
    net: { fetch: vi.fn() },
  };
});

import { createMeetIntegration, type MeetIntegrationDeps, type MeetIntegrationSettings } from "./meet-integration.js";

const ROOM_URL = "https://meet.google.com/abc-defg-hij";
const PROBE_EVERY_MS = 10_000;

type FakeTab = {
  url: string;
  answer: boolean | "hang";
  calls: number;
  getURL: () => string;
  isDestroyed: () => boolean;
  executeJavaScript: () => Promise<unknown>;
};
function meetTab(answer: boolean | "hang" = true): FakeTab {
  const t: FakeTab = {
    url: ROOM_URL,
    answer,
    calls: 0,
    getURL: () => t.url,
    isDestroyed: () => false,
    executeJavaScript: () => {
      t.calls++;
      return t.answer === "hang" ? new Promise(() => undefined) : Promise.resolve(t.answer);
    },
  };
  return t;
}

function setup(overrides: Partial<MeetIntegrationDeps> = {}, settings: Partial<MeetIntegrationSettings> = {}) {
  const tab = meetTab();
  const toast = vi.fn();
  const onCallsChanged = vi.fn();
  const deps: MeetIntegrationDeps = {
    parentWindow: {} as never,
    settings: () => ({
      meetQuietNotifications: true,
      meetMiniWindow: true,
      meetMuteShortcut: true,
      meetLogToCrm: true,
      calendarReminderMinutes: 1,
      notificationsEnabled: true,
      ...settings,
    }),
    meetViews: () => [["meet-1", tab as never]],
    workspaceOf: () => "ws-A",
    onCallsChanged,
    calendarFeedUrl: () => null,
    calendarFeedBroken: () => false,
    openMeetingUrl: vi.fn(),
    focusApp: vi.fn(),
    askText: vi.fn(async () => null),
    onCalendarChanged: vi.fn(),
    callCrm: vi.fn(async () => ({})),
    disableCrmLogPrompt: vi.fn(),
    toast,
    log: vi.fn(),
    isQuitting: () => false,
    calendarWorkerPath: "",
    ...overrides,
  };
  const meet = createMeetIntegration(deps);
  return { meet, tab, toast, onCallsChanged, deps };
}

/** Um ciclo da sonda periódica (e as promessas dela). */
const tick = (ms = PROBE_EVERY_MS) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-14T12:00:00Z"));
  electron.notifications.length = 0;
  electron.register.mockReset().mockReturnValue(true);
  electron.unregister.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("createMeetIntegration — chamada", () => {
  it("a sonda liga a chamada, o atalho do microfone e redesenha; sair desliga", async () => {
    const { meet, tab, onCallsChanged } = setup();
    await tick();
    expect(meet.anyCall()).toBe(true);
    expect(meet.isServiceInCall("meet-1")).toBe(true);
    expect(electron.register).toHaveBeenCalledOnce();
    expect(onCallsChanged).toHaveBeenCalledOnce();
    tab.answer = false;
    await tick();
    expect(meet.anyCall()).toBe(false);
    expect(electron.unregister).toHaveBeenCalledOnce();
    meet.dispose();
  });

  it("atalho ocupado por outro programa avisa uma vez só", async () => {
    electron.register.mockReturnValue(false);
    const { meet, toast } = setup();
    await tick();
    await tick();
    await tick();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(String(toast.mock.calls[0]![0])).toContain("Ctrl+Alt+M");
    meet.dispose();
  });

  it("aba travada: não empilha sondas e, depois de 6 sem resposta, encerra a chamada", async () => {
    const { meet, tab } = setup();
    await tick();
    expect(meet.anyCall()).toBe(true);
    tab.answer = "hang";
    for (let i = 0; i < 5; i++) await tick();
    expect(meet.anyCall()).toBe(true);
    await tick();
    expect(meet.anyCall()).toBe(false);
    // Não empilha uma por passada: só uma nova depois que a pendente se perde (30 s).
    expect(tab.calls).toBe(3);
    // E a hibernação passa a ver a aba fora da chamada.
    expect(meet.inCall(tab as never)).toBe(false);
    meet.dispose();
  });

  it("sonda perdida numa recarga não cega a aba: a seguinte volta a responder", async () => {
    const { meet, tab } = setup();
    await tick();
    tab.answer = "hang";
    await tick();
    tab.answer = true;
    // Sem o prazo de sonda perdida, 6 passadas encerravam a chamada em andamento.
    for (let i = 0; i < 7; i++) await tick();
    expect(meet.anyCall()).toBe(true);
    expect(meet.inCall(tab as never)).toBe(true);
    meet.dispose();
  });

  it("aba do Meet que sumiu leva a chamada junto", async () => {
    let views: Array<[string, FakeTab]> = [];
    const tab = meetTab();
    views = [["meet-1", tab]];
    const { meet } = setup({ meetViews: () => views as never });
    await tick();
    expect(meet.anyCall()).toBe(true);
    views = [];
    await tick();
    expect(meet.anyCall()).toBe(false);
    meet.dispose();
  });
});

describe("createMeetIntegration — registro no CRM ao sair", () => {
  async function callOf(minutes: number, overrides: Partial<MeetIntegrationDeps> = {}, settings = {}) {
    const ctx = setup(overrides, settings);
    await tick();
    await vi.advanceTimersByTimeAsync(minutes * 60_000 - PROBE_EVERY_MS);
    ctx.tab.answer = false;
    await tick();
    return ctx;
  }
  const crmPrompts = () => electron.notifications.filter((n) => n.options.title.includes("CRM"));

  it("reunião de 2 min ou mais oferece o registro; clicar abre a busca do contato", async () => {
    const { meet, deps } = await callOf(30);
    expect(crmPrompts()).toHaveLength(1);
    expect(crmPrompts()[0]!.options.body).toContain("30 min");
    expect(meet.hasLoggableCall()).toBe(true);
    crmPrompts()[0]!.click();
    await Promise.resolve();
    expect(deps.focusApp).toHaveBeenCalled();
    expect(deps.askText).toHaveBeenCalledWith(
      "Registrar reunião no CRM",
      expect.stringContaining("30 min"),
      "Contato",
      expect.objectContaining({ okLabel: "Buscar" }),
    );
    meet.dispose();
  });

  it("não oferece: reunião curta, app saindo, sem workspace ou opção desligada", async () => {
    (await callOf(1)).meet.dispose();
    (await callOf(30, { isQuitting: () => true })).meet.dispose();
    (await callOf(30, { workspaceOf: () => null })).meet.dispose();
    (await callOf(30, {}, { meetLogToCrm: false })).meet.dispose();
    expect(crmPrompts()).toHaveLength(0);
  });
});
