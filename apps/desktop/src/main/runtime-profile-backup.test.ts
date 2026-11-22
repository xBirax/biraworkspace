import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backupBeforeElectron44 } from "./runtime-profile-backup.js";

const roots: string[] = [];
function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr-backup-test-"));
  roots.push(root);
  return path.join(root, "ADR Workspace");
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("runtime upgrade profile backup", () => {
  it("fails without authorizing migration when the copy cannot complete", () => {
    const profile = fixture();
    fs.mkdirSync(profile);
    fs.writeFileSync(path.join(profile, "state.v1.json"), "untouched");
    vi.spyOn(fs, "cpSync").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect(() => backupBeforeElectron44(profile)).toThrow("disk full");
    expect(fs.existsSync(path.join(profile, ".electron44-backup.json"))).toBe(false);
    expect(fs.readFileSync(path.join(profile, "state.v1.json"), "utf8")).toBe("untouched");
  });
  it("preserves state, vault and partition data without changing originals", () => {
    const profile = fixture();
    for (const relative of [
      "state.v1.json",
      "Local State",
      "vault/pin.json",
      "Partitions/wa-one/Network/Cookies",
      "Partitions/crm-one/IndexedDB/db",
      "Partitions/google-one/Local Storage/leveldb/db",
      "Partitions/wa-one/Cache/file",
    ]) {
      const file = path.join(profile, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, relative);
    }
    const backup = backupBeforeElectron44(profile)!;
    expect(backup.startsWith(`${profile} Backups`)).toBe(true);
    for (const relative of [
      "state.v1.json",
      "Local State",
      "vault/pin.json",
      "Partitions/wa-one/Network/Cookies",
      "Partitions/crm-one/IndexedDB/db",
      "Partitions/google-one/Local Storage/leveldb/db",
    ]) {
      expect(fs.readFileSync(path.join(backup, "profile", relative), "utf8")).toBe(relative);
      expect(fs.readFileSync(path.join(profile, relative), "utf8")).toBe(relative);
    }
    expect(fs.existsSync(path.join(backup, "profile/Partitions/wa-one/Cache"))).toBe(false);
    fs.writeFileSync(path.join(profile, "state.v1.json"), "new state");
    expect(backupBeforeElectron44(profile)).toBe(backup);
    expect(fs.readFileSync(path.join(backup, "profile/state.v1.json"), "utf8")).toBe(
      "state.v1.json",
    );
  });
  it("does not make a migration backup for a fresh profile", () => {
    const profile = fixture();
    expect(backupBeforeElectron44(profile)).toBeNull();
    expect(fs.existsSync(`${profile} Backups`)).toBe(false);
  });
  it("backup apagado pela pessoa não é refeito a cada abertura (cópia já concluída)", () => {
    const profile = fixture();
    fs.mkdirSync(profile);
    fs.writeFileSync(path.join(profile, "state.v1.json"), "retained");
    const first = backupBeforeElectron44(profile)!;
    fs.rmSync(first, { recursive: true });
    expect(backupBeforeElectron44(profile)).toBeNull();
    expect(fs.readdirSync(`${profile} Backups`)).toEqual([]);
    expect(fs.readFileSync(path.join(profile, "state.v1.json"), "utf8")).toBe("retained");
  });
});
