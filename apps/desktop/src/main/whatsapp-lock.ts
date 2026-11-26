import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SafeStorage } from "electron";
import { writeDurableFile } from "@adr/app-state";

/**
 * `throttleGroup`: chave de tentativas herdada na migração do PIN legado. As
 * sessões que receberam a cópia do MESMO segredo contam erros juntas — com uma
 * chave por arquivo, 4 sessões davam 20 chutes por janela. Some ao trocar o PIN.
 */
type LockFile = { version: 1; ciphertext: string; throttleGroup?: string | undefined };

export function whatsappLockExpired(lastActivity: number, timeoutMs: number, now: number): boolean {
  return timeoutMs > 0 && now - lastActivity >= timeoutMs;
}

/** Visibility isn't activity. Only OS input while the app is focused advances this clock. */
export function latestWhatsAppActivity(
  last: number,
  now: number,
  idleSeconds: number,
  focused: boolean,
): number {
  if (!focused || !Number.isFinite(idleSeconds) || idleSeconds < 0) return last;
  return Math.max(last, now - idleSeconds * 1000);
}

export function isValidWhatsAppPin(pin: string): boolean {
  return /^\d{4,12}$/.test(pin);
}

export function resolveWhatsAppLocked(
  serviceId: string,
  settings: {
    whatsappLockEnabled: boolean;
    whatsappLockServiceIds: Record<string, boolean>;
  },
): boolean {
  if (serviceId in settings.whatsappLockServiceIds) {
    return settings.whatsappLockServiceIds[serviceId] === true;
  }
  const hasPerServiceConfig = Object.keys(settings.whatsappLockServiceIds).length > 0;
  if (hasPerServiceConfig) return false;
  return Boolean(settings.whatsappLockEnabled);
}

/**
 * Sessões que hoje dependem do bloqueio global legado. Assim que existe uma
 * entrada por sessão, `resolveWhatsAppLocked` deixa de olhar o flag global —
 * então quem ativa o primeiro PIN individual precisa levar estas junto, senão
 * elas ficam abertas em silêncio.
 */
export function legacyLockedWhatsAppIds(
  serviceIds: string[],
  settings: {
    whatsappLockEnabled: boolean;
    whatsappLockServiceIds: Record<string, boolean>;
  },
): string[] {
  if (Object.keys(settings.whatsappLockServiceIds).length > 0) return [];
  return serviceIds.filter((id) => resolveWhatsAppLocked(id, settings));
}

export function resolveWhatsAppLockStorageScope(
  serviceId: string,
  settings: { whatsappLockServiceIds: Record<string, boolean> },
  hasSpecificPin: boolean,
): "service" | "legacy" {
  if (serviceId in settings.whatsappLockServiceIds || hasSpecificPin) return "service";
  return "legacy";
}

export function resolveWhatsAppLockTimeoutMinutes(
  serviceId: string,
  settings: {
    whatsappLockTimeoutMinutes?: number;
    whatsappLockTimeoutServiceMinutes?: Record<string, number>;
  },
): number {
  const specific = settings.whatsappLockTimeoutServiceMinutes?.[serviceId];
  if (Number.isFinite(specific) && specific! >= 0 && specific! <= 1440) {
    return Math.round(specific!);
  }
  const legacy = settings.whatsappLockTimeoutMinutes;
  if (Number.isFinite(legacy) && legacy! >= 0 && legacy! <= 1440) {
    return Math.round(legacy!);
  }
  return 30;
}

type PinAttemptEntry = {
  failures: number;
  lockedUntil: number;
  lockouts: number;
  lastFailureAt: number;
};

/** Teto da espera progressiva: 30 s, 1, 2, 4, 8 min… até 15 min. */
export const MAX_PIN_LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Falhas sem novo erro por um dia são esquecidas. Sem isto a contagem só zerava
 * com um acerto: quatro erros de um intruso semanas atrás faziam o primeiro erro
 * de digitação do dono bloquear na hora — e a progressão acumulada, por 15 min.
 */
export const PIN_FAILURE_MEMORY_MS = 24 * 60 * 60 * 1000;

/**
 * Limite de tentativas por arquivo de PIN, não por tela. O desbloqueio, o
 * "desativar" e o "trocar PIN" verificam o mesmo segredo; se só o primeiro
 * contasse erros, os outros dois viravam força bruta sem espera.
 *
 * Gravado em disco (`persistPath`): só em memória, fechar e reabrir o app dava
 * mais 5 tentativas na hora. E a espera dobra a cada bloqueio seguido — com 30 s
 * fixos, um PIN de 4 dígitos caía numa tarde de tentativas automatizadas.
 */
export class PinAttemptThrottle {
  private readonly entries: Map<string, PinAttemptEntry>;

  constructor(
    private readonly maxAttempts = 5,
    private readonly lockoutMs = 30_000,
    private readonly persistPath?: string,
  ) {
    this.entries = new Map(this.load());
  }

  private load(): Array<[string, PinAttemptEntry]> {
    if (!this.persistPath) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.persistPath, "utf8")) as Record<string, unknown>;
      return Object.entries(raw).flatMap(([key, value]) => {
        const entry = value as Partial<PinAttemptEntry>;
        const valid = [entry?.failures, entry?.lockedUntil, entry?.lockouts, entry?.lastFailureAt].every(
          (n) => Number.isFinite(n) && (n as number) >= 0,
        );
        return valid ? [[key, entry as PinAttemptEntry] as [string, PinAttemptEntry]] : [];
      });
    } catch {
      // Arquivo ausente ou ilegível: recomeça a contagem, nunca impede o desbloqueio.
      return [];
    }
  }

  private save(): void {
    if (!this.persistPath) return;
    try {
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      const temporary = `${this.persistPath}.${process.pid}.tmp`;
      writeDurableFile(temporary, JSON.stringify(Object.fromEntries(this.entries)));
      fs.renameSync(temporary, this.persistPath);
    } catch {
      // Sem disco o limite em memória continua valendo nesta execução.
    }
  }

  /**
   * A entrada válida AGORA. Os horários gravados são absolutos, então o relógio
   * do sistema conta: se ele voltou no tempo, o bloqueio é recortado para o teto
   * (sem isto, dias de WhatsApp inacessível e sem recuperação) e falhas de
   * "outro dia" — para frente ou para trás — são esquecidas.
   *
   * ponytail: relógio de parede. Adiantar a hora do sistema encurta bloqueio e
   * esquece falhas. Não fecha com código: mudar a hora no Windows pede admin, e
   * quem roda como o usuário já decifra o cofre direto (safeStorage = DPAPI do
   * usuário). Só vale tratar se o PIN passar a ser verificado fora da máquina.
   */
  private current(key: string, now: number): PinAttemptEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.lockedUntil - now > MAX_PIN_LOCKOUT_MS) {
      entry.lockedUntil = now + MAX_PIN_LOCKOUT_MS;
      this.save();
    }
    if (entry.lockedUntil <= now && Math.abs(now - entry.lastFailureAt) >= PIN_FAILURE_MEMORY_MS) {
      this.reset(key);
      return undefined;
    }
    return entry;
  }

  /** O segredo mudou (PIN criado, trocado ou apagado): erros do PIN antigo não valem. */
  reset(key: string): void {
    if (this.entries.delete(key)) this.save();
  }

  remainingLockoutMs(key: string, now = Date.now()): number {
    return Math.max(0, (this.current(key, now)?.lockedUntil || 0) - now);
  }

  verify(
    key: string,
    check: () => boolean,
    now = Date.now(),
  ): { ok: true } | { ok: false; reason: "wrong" | "locked"; retryInMs: number } {
    const remaining = this.remainingLockoutMs(key, now);
    if (remaining > 0) return { ok: false, reason: "locked", retryInMs: remaining };
    if (check()) {
      this.reset(key);
      return { ok: true };
    }
    const entry = this.current(key, now) || {
      failures: 0,
      lockedUntil: 0,
      lockouts: 0,
      lastFailureAt: now,
    };
    entry.failures += 1;
    entry.lastFailureAt = now;
    let result: { ok: false; reason: "wrong" | "locked"; retryInMs: number } = {
      ok: false,
      reason: "wrong",
      retryInMs: 0,
    };
    if (entry.failures >= this.maxAttempts) {
      const wait = Math.min(this.lockoutMs * 2 ** entry.lockouts, MAX_PIN_LOCKOUT_MS);
      entry.failures = 0;
      entry.lockouts += 1;
      entry.lockedUntil = now + wait;
      result = { ok: false, reason: "locked", retryInMs: wait };
    }
    this.entries.set(key, entry);
    this.save();
    return result;
  }
}

/**
 * - `ok`: PIN legível.
 * - `missing` / `corrupt`: o arquivo sumiu ou não decifra — cabe a recuperação.
 * - `unavailable`: a criptografia do sistema está fora (chaveiro travado). O PIN
 *   pode estar íntegro; tratar como perdido abriria a recuperação sem PIN.
 */
export type WhatsAppPinState = "ok" | "missing" | "corrupt" | "unavailable";

import {secureStorageAvailable} from "./secure-storage.js";

export class WhatsAppLock {
  /**
   * `onSecretChanged` roda quando o PIN deste arquivo é criado, trocado ou
   * apagado — é onde o app zera o limite de tentativas, para que nenhum caminho
   * (ativar, trocar, recuperar, migrar o legado) esqueça de fazer isso.
   */
  constructor(
    private readonly filePath: string,
    private readonly storage: Pick<
      SafeStorage,
      "isEncryptionAvailable" | "encryptString" | "decryptString"
    > & Partial<Pick<SafeStorage, "getSelectedStorageBackend">>,
    private readonly onSecretChanged?: (throttleKey: string) => void,
  ) {}

  /**
   * Chave do limite de tentativas: o arquivo, que é o segredo compartilhado — ou
   * o grupo herdado na migração, enquanto o PIN copiado não for trocado.
   */
  get throttleKey(): string {
    try {
      const file = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<LockFile>;
      if (typeof file.throttleGroup === "string" && file.throttleGroup) return file.throttleGroup;
    } catch {
      // Ausente ou ilegível: a chave é o próprio arquivo.
    }
    return this.filePath;
  }

  isAvailable(): boolean {
    return secureStorageAvailable(this.storage);
  }

  pinState(): WhatsAppPinState {
    if (!this.isAvailable()) return "unavailable";
    if (!fs.existsSync(this.filePath)) return "missing";
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch {
      // Arquivo preso (antivírus, EBUSY/EPERM) é passageiro: "corrupt" abria o
      // "Desativar bloqueio" sem pedir o PIN.
      return "unavailable";
    }
    try {
      const file = JSON.parse(raw) as Partial<LockFile>;
      if (file.version !== 1 || typeof file.ciphertext !== "string") return "corrupt";
      const pin = this.storage.decryptString(Buffer.from(file.ciphertext, "base64"));
      return isValidWhatsAppPin(pin) ? "ok" : "corrupt";
    } catch {
      return "corrupt";
    }
  }

  hasPin(): boolean {
    return this.pinState() === "ok";
  }

  /**
   * Migra o PIN global legado para o cofre de uma sessão sem expor o valor. A
   * cópia herda a chave de tentativas: mesmo segredo, mesmo contador.
   */
  copyPinTo(target: WhatsAppLock): boolean {
    if (this.pinState() !== "ok") return false;
    const file = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as LockFile;
    target.writePin(
      this.storage.decryptString(Buffer.from(file.ciphertext, "base64")),
      this.throttleKey,
    );
    return true;
  }

  /** PIN definido pelo usuário (ativar/trocar): contador próprio, sem grupo. */
  setPin(pin: string): void {
    this.writePin(pin);
  }

  private writePin(pin: string, throttleGroup?: string): void {
    if (!isValidWhatsAppPin(pin)) throw new Error("Use um PIN de 4 a 12 números");
    if (!this.isAvailable()) throw new Error("A proteção segura do sistema não está disponível");
    const wrapper: LockFile = {
      version: 1,
      ciphertext: this.storage.encryptString(pin).toString("base64"),
      throttleGroup,
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeDurableFile(temporary, JSON.stringify(wrapper));
    fs.renameSync(temporary, this.filePath);
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      // Windows/NTFS ignores POSIX modes.
    }
    this.onSecretChanged?.(throttleGroup || this.filePath);
  }

  verify(pin: string): boolean {
    if (!isValidWhatsAppPin(pin) || !this.isAvailable() || !fs.existsSync(this.filePath))
      return false;
    try {
      const file = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<LockFile>;
      if (file.version !== 1 || typeof file.ciphertext !== "string") return false;
      const expected = Buffer.from(
        this.storage.decryptString(Buffer.from(file.ciphertext, "base64")),
      );
      const supplied = Buffer.from(pin);
      return expected.length === supplied.length && timingSafeEqual(expected, supplied);
    } catch {
      return false;
    }
  }

  clear(): void {
    fs.rmSync(this.filePath, { force: true });
    // Só o contador do arquivo: o grupo da migração segue valendo nas outras sessões.
    this.onSecretChanged?.(this.filePath);
  }
}
