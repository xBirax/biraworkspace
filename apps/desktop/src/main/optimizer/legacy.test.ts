import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLegacyBackup } from "./legacy.js";
import { createOptimizerController } from "./index.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("legacy backup import", () => {
  it("preserves original backup and classifies only known HKCU entries for manual review", () => {
    const local = fs.mkdtempSync(path.join(os.tmpdir(), "adr-legacy-test-"));
    dirs.push(local);
    const folder = path.join(local, "ADRBooster");
    fs.mkdirSync(folder);
    const file = path.join(folder, "backup.json");
    const original = JSON.stringify({ Items: [
      { Kind: "startup", Name: "Example", Path: "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", Command: "sensitive" },
      { Kind: "startup", Name: "Example", Path: "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", Command: "different" },
      { Kind: "reg", Name: "VisualFXSetting", Path: "hkcu:\\software\\microsoft\\windows\\currentversion\\explorer\\visualeffects", Type: "DWord", OldValue: 1 },
      { Kind: "reg", Name: "Start", Path: "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\DiagTrack", OldValue: 2 },
      { Kind: "hibernate", OldEnabled: true },
    ] });
    fs.writeFileSync(file, original);
    const result = readLegacyBackup(local);
    expect(result.present).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.entries).toHaveLength(4);
    expect(result.entries[0]).toMatchObject({ kind: "startup", scope: "HKCU", restoration: "manual" });
    expect(result.entries[0]?.original).toEqual({ type: "String", value: "sensitive" });
    expect(result.entries[1]).toMatchObject({ kind: "reg", scope: "HKCU", restoration: "manual", original: { type: "DWord", value: 1 } });
    expect(result.entries[2]).toMatchObject({ kind: "reg", scope: "HKLM", restoration: "unavailable" });
    expect(result.warnings).toContain("Duplicata legada ignorada: startup Example");
    expect(result.restorationReady).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("redacts old startup commands from exported reports", async () => {
    const local = fs.mkdtempSync(path.join(os.tmpdir(), "adr-legacy-report-"));
    dirs.push(local);
    fs.mkdirSync(path.join(local, "ADRBooster"));
    fs.writeFileSync(path.join(local, "ADRBooster", "backup.json"), JSON.stringify({ Items: [
      { Kind: "startup", Name: "Example", Path: "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", Command: "sensitive-token" },
    ] }));
    const previous = process.env['LOCALAPPDATA'];
    try {
      process.env['LOCALAPPDATA'] = local;
      const report = await createOptimizerController({ userDataDir: local }).exportReport();
      expect(report).toContain('"restorationReady": false');
      expect(report).not.toContain("sensitive-token");
    } finally {
      if (previous === undefined) delete process.env['LOCALAPPDATA'];
      else process.env['LOCALAPPDATA'] = previous;
    }
  });
});
