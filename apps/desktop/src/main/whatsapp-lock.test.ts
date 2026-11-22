import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isValidWhatsAppPin,
  legacyLockedWhatsAppIds,
  MAX_PIN_LOCKOUT_MS,
  PIN_FAILURE_MEMORY_MS,
  PinAttemptThrottle,
  resolveWhatsAppLocked,
  resolveWhatsAppLockStorageScope,
  resolveWhatsAppLockTimeoutMinutes,
  WhatsAppLock,
  whatsappLockExpired,
  latestWhatsAppActivity,
} from "./whatsapp-lock.js";

describe("PinAttemptThrottle", () => {
  it("locks out after five wrong PINs and rejects even the right one meanwhile", () => {
    const throttle = new PinAttemptThrottle(5, 30_000);
    for (let i = 0; i < 4; i++) {
      expect(throttle.verify("a", () => false, 1000)).toMatchObject({ ok: false, reason: "wrong" });
    }
    expect(throttle.verify("a", () => false, 1000)).toMatchObject({ ok: false, reason: "locked" });
    expect(throttle.remainingLockoutMs("a", 11_000)).toBe(20_000);
    let checked = false;
    const during = throttle.verify("a", () => (checked = true), 11_000);
    expect(during).toMatchObject({ ok: false, reason: "locked", retryInMs: 20_000 });
    expect(checked).toBe(false);
    expect(throttle.verify("a", () => true, 31_000)).toEqual({ ok: true });
  });

  it("doubles the wait on each consecutive lockout, up to the cap", () => {
    const throttle = new PinAttemptThrottle(2, 30_000);
    const lockout = (now: number) => {
      throttle.verify("k", () => false, now);
      return throttle.verify("k", () => false, now);
    };
    expect(lockout(0)).toMatchObject({ reason: "locked", retryInMs: 30_000 });
    expect(lockout(30_000)).toMatchObject({ reason: "locked", retryInMs: 60_000 });
    expect(lockout(90_000)).toMatchObject({ reason: "locked", retryInMs: 120_000 });
    let now = 210_000;
    for (let i = 0; i < 10; i++) {
      const result = lockout(now) as { retryInMs: number };
      now += result.retryInMs;
    }
    expect(throttle.remainingLockoutMs("k", now - 1)).toBeLessThanOrEqual(MAX_PIN_LOCKOUT_MS);
    // Acertar zera tudo, inclusive a progressão.
    expect(throttle.verify("k", () => true, now)).toEqual({ ok: true });
    expect(lockout(now)).toMatchObject({ retryInMs: 30_000 });
  });

  it("caps a lockout stretched by the clock going back in time", () => {
    const throttle = new PinAttemptThrottle(1, 30_000);
    const day = 24 * 60 * 60 * 1000;
    // Bloqueio gravado com o relógio 3 dias adiantado; depois a hora é corrigida.
    throttle.verify("k", () => false, 3 * day);
    expect(throttle.remainingLockoutMs("k", 0)).toBe(MAX_PIN_LOCKOUT_MS);
    // E expira dentro do teto, não daqui a 3 dias.
    expect(throttle.remainingLockoutMs("k", MAX_PIN_LOCKOUT_MS)).toBe(0);
  });

  it("forgets failures after a day without new errors", () => {
    const throttle = new PinAttemptThrottle(5, 30_000);
    for (let i = 0; i < 4; i++) throttle.verify("k", () => false, 0);
    // Um erro no dia seguinte é o primeiro, não o quinto.
    expect(throttle.verify("k", () => false, PIN_FAILURE_MEMORY_MS)).toMatchObject({
      reason: "wrong",
    });
    // Bloqueios antigos também saem da progressão.
    const twice = new PinAttemptThrottle(1, 30_000);
    twice.verify("k", () => false, 0);
    twice.verify("k", () => false, 30_000);
    expect(twice.verify("k", () => false, 30_000 + PIN_FAILURE_MEMORY_MS)).toMatchObject({
      retryInMs: 30_000,
    });
  });

  it("resets the attempts whenever the PIN file is set or cleared", () => {
    const throttle = new PinAttemptThrottle(5, 30_000);
    const { file } = createLock();
    const lock = new WhatsAppLock(
      file,
      {
        isEncryptionAvailable: () => true,
        encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
        decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, ""),
      },
      (key) => throttle.reset(key),
    );
    lock.setPin("1234");
    for (let i = 0; i < 5; i++) throttle.verify(lock.throttleKey, () => lock.verify("0000"));
    expect(throttle.remainingLockoutMs(lock.throttleKey)).toBeGreaterThan(0);
    lock.clear();
    expect(throttle.remainingLockoutMs(lock.throttleKey)).toBe(0);
    for (let i = 0; i < 4; i++) throttle.verify(lock.throttleKey, () => lock.verify("0000"));
    lock.setPin("5678");
    // PIN novo: um erro é o primeiro, não o quinto.
    expect(throttle.verify(lock.throttleKey, () => lock.verify("0000"))).toMatchObject({
      reason: "wrong",
    });
  });

  it("a cópia migrada herda a chave; trocar ou apagar o PIN zera só a chave do arquivo", () => {
    const { file, lock: legacy } = createLock();
    const resets: string[] = [];
    const storage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
      decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, ""),
    };
    const sessionFile = file.replace("v1.json", "wa-1.v1.json");
    const session = new WhatsAppLock(sessionFile, storage, (key) => resets.push(key));
    // Arquivo sem o campo (formato antigo): a chave é o próprio arquivo.
    legacy.setPin("4321");
    expect(legacy.throttleKey).toBe(file);
    expect(legacy.copyPinTo(session)).toBe(true);
    expect(session.throttleKey).toBe(file);
    expect(resets).toEqual([file]);
    session.setPin("1357");
    expect(session.throttleKey).toBe(sessionFile);
    expect(resets).toEqual([file, sessionFile]);
    // Apagar uma cópia migrada não zera o grupo, que segue nas outras sessões.
    legacy.copyPinTo(session);
    session.clear();
    expect(resets).toEqual([file, sessionFile, file, sessionFile]);
  });

  it("survives an app restart through the persisted file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-pin-attempts-"));
    created.push(dir);
    const file = path.join(dir, "vault", "attempts.json");
    const first = new PinAttemptThrottle(3, 30_000, file);
    first.verify("pin", () => false, 0);
    first.verify("pin", () => false, 0);
    // "Reiniciar o app": a contagem continua de onde parou.
    const second = new PinAttemptThrottle(3, 30_000, file);
    expect(second.verify("pin", () => false, 0)).toMatchObject({ reason: "locked" });
    expect(new PinAttemptThrottle(3, 30_000, file).remainingLockoutMs("pin", 10_000)).toBe(20_000);
    // Arquivo corrompido não pode travar o desbloqueio.
    fs.writeFileSync(file, "{broken");
    expect(new PinAttemptThrottle(3, 30_000, file).verify("pin", () => true, 0)).toEqual({
      ok: true,
    });
  });

  it("shares the counter per key and resets it on success", () => {
    const throttle = new PinAttemptThrottle(3, 1000);
    throttle.verify("pin-file", () => false, 0);
    throttle.verify("pin-file", () => false, 0);
    expect(throttle.verify("other", () => false, 0)).toMatchObject({ reason: "wrong" });
    expect(throttle.verify("pin-file", () => true, 0)).toEqual({ ok: true });
    expect(throttle.verify("pin-file", () => false, 0)).toMatchObject({ reason: "wrong" });
  });
});

describe("PIN inactivity", () => {
  it("does not refresh a visible idle account", () => {
    const now = 3_600_000;
    const last = latestWhatsAppActivity(0, now, 3600, true);
    expect(last).toBe(0);
    expect(whatsappLockExpired(last, 300_000, now)).toBe(true);
  });
  it("counts keyboard/mouse activity only with the app focused", () => {
    expect(latestWhatsAppActivity(1000, 10_000, 2, true)).toBe(8000);
    expect(latestWhatsAppActivity(1000, 10_000, 0, false)).toBe(1000);
    expect(latestWhatsAppActivity(1000, 10_000, NaN, true)).toBe(1000);
    expect(whatsappLockExpired(1000, 0, 1e9)).toBe(false);
    expect(whatsappLockExpired(1000, 5000, 6000)).toBe(true);
  });
});

const created: string[] = [];

function createLock(): { file: string; lock: WhatsAppLock } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-whatsapp-lock-"));
  created.push(dir);
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, ""),
  };
  const file = path.join(dir, "whatsapp-lock.v1.json");
  return { file, lock: new WhatsAppLock(file, storage) };
}

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("WhatsAppLock", () => {
  it("stores an encrypted PIN and only unlocks with its exact value", () => {
    const { file, lock } = createLock();
    lock.setPin("1234");
    expect(fs.readFileSync(file, "utf8")).not.toContain("1234");
    expect(lock.verify("1234")).toBe(true);
    expect(lock.verify("4321")).toBe(false);
    expect(lock.hasPin()).toBe(true);
  });

  it("accepts only numeric PINs between four and twelve digits", () => {
    expect(isValidWhatsAppPin("1234")).toBe(true);
    expect(isValidWhatsAppPin("123")).toBe(false);
    expect(isValidWhatsAppPin("1234a")).toBe(false);
  });

  it("detects an unavailable or corrupted PIN file", () => {
    const { file, lock } = createLock();
    expect(lock.hasPin()).toBe(false);
    fs.writeFileSync(file, '{"version":1,"ciphertext":"broken"}');
    expect(lock.hasPin()).toBe(false);
  });

  it("arquivo que não dá para ler agora (preso) é indisponível, não corrompido", () => {
    const { file, lock } = createLock();
    fs.mkdirSync(file); // ler um diretório falha como um arquivo preso pelo antivírus
    expect(lock.pinState()).toBe("unavailable");
  });

  it("distinguishes a missing/corrupt PIN from unavailable encryption", () => {
    const { file, lock } = createLock();
    expect(lock.pinState()).toBe("missing");
    fs.writeFileSync(file, '{"version":1,"ciphertext":"broken"}');
    expect(lock.pinState()).toBe("corrupt");
    lock.setPin("1234");
    expect(lock.pinState()).toBe("ok");
    const locked = new WhatsAppLock(file, {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => "",
    });
    // Chaveiro travado: o PIN continua no disco e a recuperação não pode abrir.
    expect(locked.pinState()).toBe("unavailable");
    expect(locked.hasPin()).toBe(false);
  });

  it("carries legacy-locked sessions over when the first per-session PIN is set", () => {
    const legacy = { whatsappLockEnabled: true, whatsappLockServiceIds: {} };
    expect(legacyLockedWhatsAppIds(["wa-1", "wa-3"], legacy)).toEqual(["wa-1", "wa-3"]);
    expect(
      legacyLockedWhatsAppIds(["wa-1"], { whatsappLockEnabled: false, whatsappLockServiceIds: {} }),
    ).toEqual([]);
    // Já migrado: o mapa manda, nada a carregar.
    expect(
      legacyLockedWhatsAppIds(["wa-1"], {
        whatsappLockEnabled: true,
        whatsappLockServiceIds: { "wa-2": true },
      }),
    ).toEqual([]);

    const { file, lock } = createLock();
    const target = new WhatsAppLock(file.replace("v1.json", "wa-1.v1.json"), {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
      decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, ""),
    });
    expect(lock.copyPinTo(target)).toBe(false);
    lock.setPin("4321");
    expect(lock.copyPinTo(target)).toBe(true);
    expect(target.verify("4321")).toBe(true);
  });

  it("isolates PINs across multiple independent lock files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-whatsapp-multi-lock-"));
    created.push(dir);
    const storage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
      decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, ""),
    };
    const lock1 = new WhatsAppLock(path.join(dir, "whatsapp-lock.s1.v1.json"), storage);
    const lock2 = new WhatsAppLock(path.join(dir, "whatsapp-lock.s2.v1.json"), storage);

    lock1.setPin("1111");
    lock2.setPin("2222");

    expect(lock1.verify("1111")).toBe(true);
    expect(lock1.verify("2222")).toBe(false);

    expect(lock2.verify("2222")).toBe(true);
    expect(lock2.verify("1111")).toBe(false);
  });

  it("resolveWhatsAppLocked isolates lock per account when per-service config exists", () => {
    const settings = {
      whatsappLockEnabled: true,
      whatsappLockServiceIds: { "wa-1": true, "wa-2": false },
    };
    expect(resolveWhatsAppLocked("wa-1", settings)).toBe(true);
    expect(resolveWhatsAppLocked("wa-2", settings)).toBe(false);
    expect(resolveWhatsAppLocked("wa-3", settings)).toBe(false);
  });

  it("resolveWhatsAppLocked falls back to legacy global flag only without per-service config", () => {
    expect(
      resolveWhatsAppLocked("wa-1", {
        whatsappLockEnabled: true,
        whatsappLockServiceIds: {},
      }),
    ).toBe(true);
    expect(
      resolveWhatsAppLocked("wa-1", {
        whatsappLockEnabled: false,
        whatsappLockServiceIds: {},
      }),
    ).toBe(false);
  });

  it("never falls back to the legacy global PIN for an explicitly configured account", () => {
    expect(
      resolveWhatsAppLockStorageScope("wa-1", { whatsappLockServiceIds: { "wa-1": true } }, false),
    ).toBe("service");
    expect(resolveWhatsAppLockStorageScope("wa-1", { whatsappLockServiceIds: {} }, false)).toBe(
      "legacy",
    );
  });

  it("resolves inactivity timeout per WhatsApp with the legacy global value as fallback", () => {
    const settings = {
      whatsappLockTimeoutMinutes: 30,
      whatsappLockTimeoutServiceMinutes: { "wa-1": 5, "wa-2": 0 },
    };
    expect(resolveWhatsAppLockTimeoutMinutes("wa-1", settings)).toBe(5);
    expect(resolveWhatsAppLockTimeoutMinutes("wa-2", settings)).toBe(0);
    expect(resolveWhatsAppLockTimeoutMinutes("wa-3", settings)).toBe(30);
  });

  it("normalizes an invalid legacy timeout instead of disabling protection accidentally", () => {
    expect(
      resolveWhatsAppLockTimeoutMinutes("wa-1", {
        whatsappLockTimeoutMinutes: Number.NaN,
        whatsappLockTimeoutServiceMinutes: {},
      }),
    ).toBe(30);
  });
});
