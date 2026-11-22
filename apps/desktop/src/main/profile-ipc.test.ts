import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@adr/contracts";
import type * as ProfileBackup from "./profile-backup.js";

const electron = vi.hoisted(() => ({
  encryptionAvailable: true,
  showMessageBox: vi.fn(),
  openPath: vi.fn(async () => ""),
}));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => electron.encryptionAvailable,
    encryptString: (text: string) => Buffer.from(`sealed:${text}`),
  },
  dialog: { showMessageBox: electron.showMessageBox },
  shell: { openPath: electron.openPath },
}));
const backup = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("./profile-backup.js", async (original) => ({
  ...(await original<typeof ProfileBackup>()),
  startBackupAndRestart: backup.start,
}));

import { registerProfileIpc } from "./profile-ipc.js";

const FEED = "https://calendar.google.com/calendar/ical/eu%40adr.com/private-abc123/basic.ics";

function setup(initial: Partial<AppSettings> = {}) {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  let settings = { permissionGrants: {}, ...initial } as AppSettings;
  const deps = {
    handle: (channel: string, fn: (event: never, ...args: never[]) => unknown) =>
      handlers.set(channel, fn as never),
    parentWindow: { isDestroyed: () => false } as never,
    settings: () => settings,
    updateSettings: vi.fn((change: (s: AppSettings) => AppSettings) => {
      settings = change(settings);
    }),
    refreshCalendar: vi.fn(async () => ({ ok: true, message: "1 reunião", count: 1 })),
    broadcast: vi.fn(),
    notify: vi.fn(),
    log: vi.fn(),
    userData: "C:/perfil-de-teste",
    backupScriptPath: "C:/app/backup-profile.ps1",
    relaunchPath: "",
    quitForBackup: vi.fn(),
  };
  registerProfileIpc(deps);
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);
  return { deps, call, settings: () => settings };
}

beforeEach(() => {
  electron.encryptionAvailable = true;
  electron.showMessageBox.mockReset();
  backup.start.mockReset();
});

describe("registerProfileIpc — agenda", () => {
  it("endereço que não é o iCal secreto do Google não chega a ser gravado", async () => {
    const { call, deps } = setup();
    const result = (await call("shell:set-calendar-feed", "https://exemplo.com/agenda.ics")) as { ok: boolean };
    expect(result.ok).toBe(false);
    expect(deps.updateSettings).not.toHaveBeenCalled();
    expect(deps.refreshCalendar).not.toHaveBeenCalled();
  });

  it("grava cifrado, lê a agenda e avisa as telas", async () => {
    const { call, deps, settings } = setup();
    await expect(call("shell:set-calendar-feed", `  ${FEED}  `)).resolves.toMatchObject({ ok: true, count: 1 });
    expect(Buffer.from(String(settings().calendarFeedSealed), "base64").toString()).toBe(`sealed:${FEED}`);
    expect(deps.refreshCalendar).toHaveBeenCalledOnce();
    expect(deps.broadcast).toHaveBeenCalledOnce();
  });

  it("campo vazio desliga o lembrete (apaga o endereço) e atualiza as telas", async () => {
    const { call, deps, settings } = setup({ calendarFeedSealed: "abc" } as Partial<AppSettings>);
    await expect(call("shell:set-calendar-feed", "")).resolves.toMatchObject({ ok: true, count: 0 });
    expect("calendarFeedSealed" in settings()).toBe(false);
    expect(deps.refreshCalendar).toHaveBeenCalledOnce();
    expect(deps.broadcast).toHaveBeenCalledOnce();
  });

  it("sem o cofre do Windows, recusa em vez de gravar o endereço aberto", async () => {
    electron.encryptionAvailable = false;
    const { call, deps } = setup();
    await expect(call("shell:set-calendar-feed", FEED)).resolves.toMatchObject({ ok: false });
    expect(deps.updateSettings).not.toHaveBeenCalled();
  });
});

describe("registerProfileIpc — permissões", () => {
  it("chave que não é texto é recusada sem mexer nas configurações", () => {
    const { call, deps } = setup({ permissionGrants: { "https://a.com|media:audio": true } });
    expect(call("shell:revoke-permission-grant", { toString: () => "*" })).toEqual({ ok: false });
    expect(deps.updateSettings).not.toHaveBeenCalled();
  });

  it("revoga e registra no log", () => {
    const { call, settings, deps } = setup({ permissionGrants: { "https://a.com|media:audio": true } });
    expect(call("shell:revoke-permission-grant", "https://a.com|media:audio")).toEqual({ ok: true });
    expect(settings().permissionGrants).toEqual({});
    expect(deps.log).toHaveBeenCalledWith("permissão revogada", { todas: false });
  });
});

describe("registerProfileIpc — backup", () => {
  it("cancelar no diálogo não fecha o app", async () => {
    electron.showMessageBox.mockResolvedValueOnce({ response: 0 });
    const { call, deps } = setup();
    await expect(call("shell:backup-profile")).resolves.toEqual({ ok: false, message: "Cancelado" });
    expect(backup.start).not.toHaveBeenCalled();
    expect(deps.quitForBackup).not.toHaveBeenCalled();
  });

  it("se o script não sobe, o app continua aberto e a falha volta para a tela", async () => {
    electron.showMessageBox.mockResolvedValueOnce({ response: 1 });
    backup.start.mockReturnValueOnce({ ok: false, message: "script ausente" });
    const { call, deps } = setup();
    await expect(call("shell:backup-profile")).resolves.toEqual({ ok: false, message: "script ausente" });
    expect(deps.quitForBackup).not.toHaveBeenCalled();
  });

  it("com o script no ar, fecha o app para a cópia", async () => {
    electron.showMessageBox.mockResolvedValueOnce({ response: 1 });
    backup.start.mockReturnValueOnce({ ok: true, message: "" });
    const { call, deps } = setup();
    await expect(call("shell:backup-profile")).resolves.toMatchObject({ ok: true });
    expect(backup.start).toHaveBeenCalledWith(expect.objectContaining({ label: "manual", relaunch: "" }));
    expect(deps.quitForBackup).toHaveBeenCalledOnce();
  });
});
