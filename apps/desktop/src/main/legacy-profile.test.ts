import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEGACY_PROFILE_NAME, MIGRATION_MARKER, legacyProfileInUse, migrateLegacyProfile } from "./legacy-profile.js";

const symlinks = process.platform !== "win32";
let appData: string;
let legacy: string;
let target: string;

function seedLegacy() {
  fs.mkdirSync(path.join(legacy, "Partitions", "wa-conta-principal", "IndexedDB"), { recursive: true });
  fs.writeFileSync(path.join(legacy, "state.v1.json"), '{"schemaVersion":1}');
  fs.writeFileSync(path.join(legacy, "Partitions", "wa-conta-principal", "IndexedDB", "wawc.ldb"), "sessao");
  fs.mkdirSync(path.join(legacy, "Cache"));
  fs.writeFileSync(path.join(legacy, "Cache", "data_0"), "cache");
}

beforeEach(() => {
  appData = fs.mkdtempSync(path.join(os.tmpdir(), "bira-legacy-"));
  legacy = path.join(appData, LEGACY_PROFILE_NAME);
  target = path.join(appData, "BiraWorkspace");
});
afterEach(() => fs.rmSync(appData, { recursive: true, force: true }));

describe("migração do perfil do ADR Workspace", () => {
  it("copia sessões e estado, mantém o original e pula caches", () => {
    seedLegacy();
    const copyKeyring = vi.fn(() => "copied" as const);
    const result = migrateLegacyProfile({ appData, target, appName: "BiraWorkspace", copyKeyring });
    expect(result).toEqual({ status: "migrated", source: legacy, keyring: "copied" });
    expect(copyKeyring).toHaveBeenCalledWith("ADR Workspace", "BiraWorkspace");
    expect(fs.readFileSync(path.join(target, "Partitions", "wa-conta-principal", "IndexedDB", "wawc.ldb"), "utf8")).toBe("sessao");
    expect(fs.existsSync(path.join(target, "Cache"))).toBe(false);
    expect(fs.existsSync(path.join(target, MIGRATION_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(legacy, "state.v1.json"))).toBe(true);
    expect(fs.readdirSync(appData).some((name) => name.includes(".migrando-"))).toBe(false);
  });

  it("não toca num perfil BiraWorkspace que já tem estado", () => {
    seedLegacy();
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "state.v1.json"), "atual");
    const copyKeyring = vi.fn(() => "copied" as const);
    expect(migrateLegacyProfile({ appData, target, appName: "BiraWorkspace", copyKeyring })).toEqual({ status: "target-exists" });
    expect(fs.readFileSync(path.join(target, "state.v1.json"), "utf8")).toBe("atual");
    expect(copyKeyring).not.toHaveBeenCalled();
  });

  it("guarda ao lado um perfil novo criado sem estado", () => {
    seedLegacy();
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "Local State"), "{}");
    const now = () => new Date("2026-11-26T12:00:00Z");
    migrateLegacyProfile({ appData, target, appName: "BiraWorkspace", copyKeyring: () => "unavailable", now });
    expect(fs.existsSync(path.join(target, "state.v1.json"))).toBe(true);
    expect(fs.existsSync(`${target}.anterior-2026-11-26T12-00-00-000Z`)).toBe(true);
  });

  it("ignora a ausência do ADR Workspace ou de estado nele", () => {
    expect(migrateLegacyProfile({ appData, target, appName: "BiraWorkspace" })).toEqual({ status: "no-legacy" });
    fs.mkdirSync(legacy);
    expect(migrateLegacyProfile({ appData, target, appName: "BiraWorkspace" })).toEqual({ status: "no-legacy" });
    expect(fs.existsSync(target)).toBe(false);
  });

  it.runIf(symlinks)("espera o ADR Workspace fechar antes de copiar", () => {
    seedLegacy();
    fs.symlinkSync("maquina-4242", path.join(legacy, "SingletonLock"));
    const result = migrateLegacyProfile({ appData, target, appName: "BiraWorkspace", hostname: "maquina", isAlive: (pid) => pid === 4242 });
    expect(result).toEqual({ status: "legacy-running", source: legacy });
    expect(fs.existsSync(target)).toBe(false);
  });

  it.runIf(symlinks)("trata lock de processo encerrado ou de outra máquina como livre e não o copia", () => {
    seedLegacy();
    fs.symlinkSync("maquina-4242", path.join(legacy, "SingletonLock"));
    expect(legacyProfileInUse(legacy, "maquina", () => false)).toBe(false);
    expect(legacyProfileInUse(legacy, "outra", () => true)).toBe(false);
    const result = migrateLegacyProfile({ appData, target, appName: "BiraWorkspace", hostname: "maquina", isAlive: () => false, copyKeyring: () => "unavailable" });
    expect(result.status).toBe("migrated");
    expect(() => fs.lstatSync(path.join(target, "SingletonLock"))).toThrow();
  });
});
