import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOptimizerController } from "./index.js";

vi.mock("./metrics.js", () => ({
  collectOptimizerMetrics: async () => ({
    cpuPercent: 25, memoryUsedBytes: 4 * 1024 ** 3, memoryTotalBytes: 8 * 1024 ** 3,
    appMemoryBytes: 200 * 1024 ** 2, diskFreeBytes: 40 * 1024 ** 3, diskTotalBytes: 100 * 1024 ** 3,
    sampledAt: new Date().toISOString(), cpuHighSeconds: 0, memoryHighSeconds: 0, processes: [], warnings: [],
  }),
}));

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-optimizer-test-"));
  dirs.push(dir);
  return dir;
}

describe("optimizer journal and preview", () => {
  it("records the previous Workspace limit before changing it and restores after restart", async () => {
    const userDataDir = tempDir();
    let maxLoadedViews = 12;
    const options = {
      userDataDir,
      captureWorkspace: () => ({ maxLoadedViews }),
      setMaxLoadedViews: (count: number) => { maxLoadedViews = count; },
    };
    const controller = createOptimizerController(options);
    const snapshot = await controller.analyze();
    expect(snapshot.recommendations.some((entry) => entry.id === "workspace:max-views" && entry.reversible)).toBe(true);
    const preview = await controller.preview(["workspace:max-views"]);
    expect(preview.irreversible).toBe(false);
    const run = await controller.apply(preview.id, false);
    expect(run.status).toBe("completed");
    expect(maxLoadedViews).not.toBe(12);
    expect(run.actions[0]?.result).not.toHaveProperty("before");
    await expect(controller.preview(["workspace:max-views"])).rejects.toThrow("análise");

    const restarted = createOptimizerController(options);
    expect(restarted.getRun(run.id)?.status).toBe("completed");
    const restored = await restarted.restore(run.id, "workspace:max-views");
    expect(restored.actions[0]?.status).toBe("restored");
    expect(maxLoadedViews).toBe(12);
  });

  it("allows suspension without irreversible cleanup confirmation and reports it as nonrestorable", async () => {
    const controller = createOptimizerController({ userDataDir: tempDir(), captureWorkspace: () => ({ idleLoadedServices: 2 }), hibernateEligible: async () => ({ hibernated: 2, skipped: 1 }) });
    await controller.analyze();
    const preview = await controller.preview(["workspace:hibernate"]);
    expect(preview.irreversible).toBe(false);
    expect(preview.actions[0]?.reversible).toBe(false);
    const run = await controller.apply(preview.id, false);
    expect(run.actions[0]?.result).toEqual({ hibernated: 2, skipped: 1 });
    await expect(controller.restore(run.id, "workspace:hibernate")).rejects.toThrow("não restaurável");
  });

  it("rejects duplicate actions and preserves its read-only legacy boundary", async () => {
    const userDataDir = tempDir();
    const controller = createOptimizerController({ userDataDir, hibernateEligible: async () => ({ hibernated: 0, skipped: 0 }) });
    await controller.analyze();
    await expect(controller.preview(["workspace:hibernate", "workspace:hibernate"])).rejects.toThrow("Seleção inválida");
    const report = JSON.parse(await controller.exportReport()) as { legacy: { present: boolean }; format: string };
    expect(report.format).toBe("adr-workspace-performance-v1");
    expect(report.legacy.present).toBe(false);
    expect(fs.existsSync(path.join(userDataDir, "ADRBooster"))).toBe(false);
  });

  it("marks an unfinished mutation as interrupted after a process restart", () => {
    const userDataDir = tempDir();
    const dir = path.join(userDataDir, "performance-runs");
    fs.mkdirSync(dir);
    const id = "01234567-89ab-4cde-8f01-23456789abcd";
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({
      id, previewId: "preview", createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z",
      status: "running", actions: [{ id: "power:8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c", title: "Power", description: "", category: "power", reversible: true, requiresAdmin: false, status: "running", result: { before: { active: "381b4222-f694-41f0-9685-ff5bb260df2e" } } }],
    }));
    const controller = createOptimizerController({ userDataDir });
    expect(controller.getRun(id)?.status).toBe("interrupted");
    expect(controller.getRun(id)?.actions[0]?.status).toBe("interrupted");
    expect(controller.getRun(id)?.actions[0]?.result).not.toHaveProperty("before");
    expect(JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")).actions[0].result.before.active).toBe("381b4222-f694-41f0-9685-ff5bb260df2e");
  });

  it("fails closed when a mutation lock already exists", async () => {
    const userDataDir = tempDir();
    let changed = false;
    const controller = createOptimizerController({ userDataDir, captureWorkspace: () => ({ idleLoadedServices: 1 }), hibernateEligible: async () => { changed = true; return { hibernated: 1, skipped: 0 }; } });
    await controller.analyze();
    const preview = await controller.preview(["workspace:hibernate"]);
    const dir = path.join(userDataDir, "performance-runs");
    fs.mkdirSync(dir);
    const lock = path.join(dir, ".mutation.lock");
    fs.writeFileSync(lock, "pending");
    await expect(controller.apply(preview.id, false)).rejects.toThrow("lock pendente");
    expect(changed).toBe(false);
    expect(fs.readFileSync(lock, "utf8")).toBe("pending");
  });
});
