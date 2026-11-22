import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PartitionRegistry,
  assertSafePartitionName,
  createPartitionName,
  quarantinePartitions,
  restoreQuarantinedPartitions,
  purgeWorkspaceRecovery,
  livePartitionPath,
} from "../src/index.js";

describe("partition registry", () => {
  it("creates isolated names per profile", () => {
    const a = createPartitionName("whatsapp", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    const b = createPartitionName("whatsapp", "ffffffff-1111-2222-3333-444444444444");
    expect(a).not.toBe(b);
    assertSafePartitionName(a);
    assertSafePartitionName(b);
  });

  it("never accepts renderer-provided names", () => {
    const registry = new PartitionRegistry();
    expect(() => registry.rejectExternalName("persist:evil")).toThrow(/rejected/);
    const name = registry.allocate("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "crm");
    expect(registry.get("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(name);
  });
});

describe("partition quarantine", () => {
  const wsA = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const wsB = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
  const partA = createPartitionName("whatsapp", wsA);
  const partB = createPartitionName("crm", wsB);

  it("restore keeps session bytes; purge only hits chosen UUID", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr-part-"));
    const liveA = livePartitionPath(root, partA);
    const liveB = livePartitionPath(root, partB);
    fs.mkdirSync(liveA, { recursive: true });
    fs.mkdirSync(liveB, { recursive: true });
    fs.writeFileSync(path.join(liveA, "Cookies"), "session-a");
    fs.writeFileSync(path.join(liveB, "Cookies"), "session-b");

    quarantinePartitions(root, wsA, [partA]);
    expect(fs.existsSync(liveA)).toBe(false);
    expect(fs.readFileSync(path.join(root, "recovery", wsA, partA.slice(8), "Cookies"), "utf8")).toBe(
      "session-a",
    );
    expect(fs.readFileSync(path.join(liveB, "Cookies"), "utf8")).toBe("session-b");

    restoreQuarantinedPartitions(root, wsA, [partA]);
    expect(fs.readFileSync(path.join(liveA, "Cookies"), "utf8")).toBe("session-a");

    quarantinePartitions(root, wsA, [partA]);
    quarantinePartitions(root, wsB, [partB]);
    purgeWorkspaceRecovery(root, wsA);
    expect(fs.existsSync(path.join(root, "recovery", wsA))).toBe(false);
    expect(fs.readFileSync(path.join(root, "recovery", wsB, partB.slice(8), "Cookies"), "utf8")).toBe(
      "session-b",
    );

    expect(() => purgeWorkspaceRecovery(root, "../evil")).toThrow();
    expect(() => quarantinePartitions(root, wsA, ["persist:evil-path"])).toThrow();
  });
});
