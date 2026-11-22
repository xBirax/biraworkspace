import { afterEach, describe, expect, it, vi } from "vitest";
import { collectOptimizerMetrics } from "./metrics.js";

afterEach(() => vi.useRealTimers());

describe("collectOptimizerMetrics", () => {
  it("samples for fifteen seconds and counts a shared renderer once", async () => {
    vi.useFakeTimers();
    const progress: number[] = [];
    const pending = collectOptimizerMetrics({
      userDataDir: process.cwd(),
      appProcesses: () => [
        { pid: 42, creationTime: 100, type: "renderer", memory: { workingSetSize: 512 } },
        { pid: 42, creationTime: 100, type: "renderer", memory: { workingSetSize: 512 } },
      ],
      onProgress: (sample) => progress.push(sample),
    });
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await pending;
    expect(progress).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
    expect(result.processes).toHaveLength(1);
    expect(result.appMemoryBytes).toBe(512 * 1024);
    expect(result.memoryTotalBytes).toBeGreaterThan(0);
  });

  it("reports unavailable process measurements instead of inventing a value", async () => {
    vi.useFakeTimers();
    const pending = collectOptimizerMetrics({ userDataDir: process.cwd() });
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await pending;
    expect(result.appMemoryBytes).toBeNull();
    expect(result.warnings).toContain("Memória do Workspace indisponível");
  });
});
