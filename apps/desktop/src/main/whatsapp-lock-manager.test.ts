import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppStateV1 } from "@adr/contracts";
import { parseAppState } from "@adr/app-state";
import { softDeleteService } from "@adr/service-adapters";
import { addServiceToWorkspace, bootstrapAppState } from "./service-catalog.js";
import { PinAttemptThrottle, WhatsAppLock } from "./whatsapp-lock.js";
import { LOCK_STORAGE_UNAVAILABLE, WhatsAppLockManager } from "./whatsapp-lock-manager.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Montagem igual à da janela (vault em disco, safeStorage falso que dá para
 * "travar"), sem Electron. O estado começa com três WhatsApps no workspace.
 */
function setup(settings: Partial<AppStateV1["settings"]> = {}) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "adr-lock-manager-"));
  dirs.push(vault);
  const keyring = { available: true };
  const storage = {
    getSelectedStorageBackend: () => "gnome_libsecret" as const,
    isEncryptionAvailable: () => keyring.available,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, ""),
  };
  let state = bootstrapAppState();
  state = addServiceToWorkspace(state, "whatsapp", "WhatsApp 2");
  state = addServiceToWorkspace(state, "whatsapp", "WhatsApp 3");
  state = parseAppState({ ...state, settings: { ...state.settings, ...settings } });
  const workspaceId = state.activeWorkspaceId!;
  const ids = state.services.filter((s) => s.kind === "whatsapp").map((s) => s.id);
  const legacyLock = new WhatsAppLock(path.join(vault, "whatsapp-lock.v1.json"), storage);
  const sessionLock = (id: string) => new WhatsAppLock(path.join(vault, `whatsapp-lock.${id}.v1.json`), storage);
  const commits: AppStateV1[] = [];
  const manager = new WhatsAppLockManager({
    getState: () => state,
    commit: (next) => {
      state = next;
      commits.push(next);
    },
    legacyLock,
    sessionLock,
  });
  return {
    manager,
    ids: ids as [string, string, string],
    workspaceId,
    legacyLock,
    sessionLock,
    keyring,
    commits,
    state: () => state,
    setState: (next: AppStateV1) => {
      state = next;
    },
  };
}

describe("WhatsAppLockManager — migração do PIN global legado", () => {
  it("leva toda sessão protegida para o mapa com o MESMO PIN e apaga o global", () => {
    const env = setup({ whatsappLockEnabled: true, whatsappLockServiceIds: {} });
    env.legacyLock.setPin("2468");
    expect(env.manager.migrateLegacy()).toBe(true);
    for (const id of env.ids) {
      expect(env.state().settings.whatsappLockServiceIds[id]).toBe(true);
      expect(env.sessionLock(id).verify("2468")).toBe(true);
      expect(env.manager.isLocked(id)).toBe(true);
    }
    expect(env.legacyLock.pinState()).toBe("missing");
    // Idempotente: a segunda chamada não grava nada.
    expect(env.manager.migrateLegacy()).toBe(true);
    expect(env.commits).toHaveLength(1);
  });

  it("com o chaveiro travado não migra nem apaga nada (senão o PIN viraria 'ausente' e abriria a recuperação)", () => {
    const env = setup({ whatsappLockEnabled: true, whatsappLockServiceIds: {} });
    env.legacyLock.setPin("2468");
    env.keyring.available = false;
    expect(env.manager.migrateLegacy()).toBe(false);
    expect(env.commits).toHaveLength(0);
    expect(env.manager.target(env.ids[0], env.workspaceId)).toEqual(LOCK_STORAGE_UNAVAILABLE);
    // Destravou: a próxima ação migra.
    env.keyring.available = true;
    expect(env.manager.target(env.ids[0], env.workspaceId)).toMatchObject({ ok: true });
    expect(env.sessionLock(env.ids[1]).verify("2468")).toBe(true);
  });

  it("inclui sessões na lixeira: restauradas, voltam protegidas", () => {
    const env = setup({ whatsappLockEnabled: true, whatsappLockServiceIds: {} });
    env.legacyLock.setPin("2468");
    env.setState(softDeleteService(env.state(), env.ids[2]));
    env.manager.migrateLegacy();
    expect(env.state().settings.whatsappLockServiceIds[env.ids[2]]).toBe(true);
    expect(env.sessionLock(env.ids[2]).verify("2468")).toBe(true);
  });

  it("PIN global corrompido: as sessões ficam protegidas e caem na recuperação delas, não abertas", () => {
    const env = setup({ whatsappLockEnabled: true, whatsappLockServiceIds: {} });
    fs.writeFileSync(path.join(path.dirname(env.legacyLock.throttleKey), "whatsapp-lock.v1.json"), "{broken");
    expect(env.manager.migrateLegacy()).toBe(true);
    for (const id of env.ids) {
      expect(env.manager.isLocked(id)).toBe(true);
      expect(env.sessionLock(id).pinState()).toBe("missing");
    }
  });

  it("sem bloqueio legado não faz nada", () => {
    const env = setup();
    expect(env.manager.migrateLegacy()).toBe(true);
    expect(env.commits).toHaveLength(0);
  });
});

describe("WhatsAppLockManager — ações por sessão", () => {
  it("ativar e desativar UMA sessão não muda as outras (inclusive vindo do legado)", () => {
    const env = setup({ whatsappLockEnabled: true, whatsappLockServiceIds: {} });
    env.legacyLock.setPin("2468");
    const target = env.manager.target(env.ids[0], env.workspaceId);
    if (!target.ok) throw new Error(target.message);
    env.manager.remove(target.service.id, target.lock);
    expect(env.manager.isLocked(env.ids[0])).toBe(false);
    expect(env.manager.isLocked(env.ids[1])).toBe(true);
    expect(env.manager.isLocked(env.ids[2])).toBe(true);
    expect(env.sessionLock(env.ids[1]).verify("2468")).toBe(true);
    expect(env.state().settings.whatsappLockEnabled).toBe(true);

    // Reativar a mesma sessão com PIN novo: as outras seguem com o PIN legado.
    expect(env.manager.enableRefusal(target.service, target.lock)).toBeNull();
    env.manager.enable(target.service, target.lock, "1357");
    expect(env.manager.isLocked(env.ids[0])).toBe(true);
    expect(target.lock.verify("1357")).toBe(true);
    expect(env.sessionLock(env.ids[1]).verify("2468")).toBe(true);
    expect(env.sessionLock(env.ids[1]).verify("1357")).toBe(false);
    expect(env.manager.isLocked(env.ids[2])).toBe(true);
  });

  it("sessões migradas do mesmo PIN legado dividem o limite de tentativas até trocarem o PIN", () => {
    const env = setup({ whatsappLockEnabled: true, whatsappLockServiceIds: {} });
    const throttle = new PinAttemptThrottle(5, 30_000);
    env.legacyLock.setPin("2468");
    env.manager.migrateLegacy();
    const [a, b] = [env.sessionLock(env.ids[0]), env.sessionLock(env.ids[1])];
    expect(a.throttleKey).toBe(b.throttleKey);
    // O campo do grupo não atrapalha a leitura do PIN.
    expect(a.pinState()).toBe("ok");
    expect(a.verify("2468")).toBe(true);
    // 5 erros espalhados entre duas sessões bloqueiam as duas — não 5 por sessão.
    for (let i = 0; i < 3; i++) throttle.verify(a.throttleKey, () => a.verify("0000"), 0);
    for (let i = 0; i < 2; i++) throttle.verify(b.throttleKey, () => b.verify("0000"), 0);
    expect(throttle.remainingLockoutMs(a.throttleKey, 0)).toBeGreaterThan(0);
    expect(throttle.remainingLockoutMs(b.throttleKey, 0)).toBeGreaterThan(0);

    // Trocou o PIN de uma: contador próprio, e o grupo das outras continua bloqueado.
    a.setPin("1357");
    expect(a.throttleKey).not.toBe(b.throttleKey);
    expect(throttle.remainingLockoutMs(a.throttleKey, 0)).toBe(0);
    expect(throttle.remainingLockoutMs(b.throttleKey, 0)).toBeGreaterThan(0);
    expect(env.sessionLock(env.ids[2]).throttleKey).toBe(b.throttleKey);
  });

  it("ativar grava o PIN da sessão e a marca protegida", () => {
    const env = setup();
    const target = env.manager.target(env.ids[1], env.workspaceId);
    if (!target.ok) throw new Error(target.message);
    expect(env.manager.enableRefusal(target.service, target.lock)).toBeNull();
    env.manager.enable(target.service, target.lock, "1357");
    expect(env.manager.isLocked(env.ids[1])).toBe(true);
    expect(env.manager.isLocked(env.ids[0])).toBe(false);
    expect(target.lock.verify("1357")).toBe(true);
  });

  it("recusa ativar por cima de um PIN existente (seria trocar sem pedir o atual)", () => {
    const env = setup();
    const target = env.manager.target(env.ids[0], env.workspaceId);
    if (!target.ok) throw new Error(target.message);
    env.manager.enable(target.service, target.lock, "1357");
    expect(env.manager.enableRefusal(target.service, target.lock)).toMatch(/Trocar PIN/);
    // PIN do cofre perdido: ativar de novo é permitido (recria a proteção).
    target.lock.clear();
    expect(env.manager.enableRefusal(target.service, target.lock)).toBeNull();
  });

  it("com o chaveiro travado, recusa ativar antes de pedir o PIN", () => {
    const env = setup();
    const target = env.manager.target(env.ids[0], env.workspaceId);
    if (!target.ok) throw new Error(target.message);
    env.keyring.available = false;
    expect(env.manager.enableRefusal(target.service, target.lock)).toBe(LOCK_STORAGE_UNAVAILABLE.message);
  });

  it("PIN inválido não marca a sessão como protegida", () => {
    const env = setup();
    const target = env.manager.target(env.ids[0], env.workspaceId);
    if (!target.ok) throw new Error(target.message);
    expect(() => env.manager.enable(target.service, target.lock, "12a")).toThrow();
    expect(env.manager.isLocked(env.ids[0])).toBe(false);
  });

  it("desativar a última sessão protegida desliga o flag e limpa as opções dela", () => {
    const env = setup();
    const target = env.manager.target(env.ids[0], env.workspaceId);
    if (!target.ok) throw new Error(target.message);
    env.manager.enable(target.service, target.lock, "1357");
    env.setState(
      parseAppState({
        ...env.state(),
        settings: {
          ...env.state().settings,
          whatsappLockOnLeaveServiceIds: { [env.ids[0]]: true },
          whatsappLockTimeoutServiceMinutes: { [env.ids[0]]: 5 },
        },
      }),
    );
    env.manager.remove(env.ids[0], target.lock);
    const settings = env.state().settings;
    expect(settings.whatsappLockEnabled).toBe(false);
    expect(settings.whatsappLockOnLeaveServiceIds).toEqual({});
    expect(settings.whatsappLockTimeoutServiceMinutes).toEqual({});
    expect(target.lock.pinState()).toBe("missing");
  });

  it("só aceita sessão de WhatsApp ativa do workspace atual", () => {
    const env = setup();
    expect(env.manager.target("nao-existe", env.workspaceId)).toMatchObject({ ok: false });
    expect(env.manager.target(env.ids[0], "outro-workspace")).toMatchObject({ ok: false });
    env.setState(softDeleteService(env.state(), env.ids[0]));
    expect(env.manager.target(env.ids[0], env.workspaceId)).toMatchObject({ ok: false });
  });
});
