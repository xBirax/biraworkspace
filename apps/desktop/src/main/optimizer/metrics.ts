import fs from "node:fs";
import os from "node:os";

export type AppProcessMetric = {
  pid: number;
  creationTime?: number;
  type?: string;
  memory?: { workingSetSize?: number };
  cpu?: { percentCPUUsage?: number };
};

export type SampledProcess = {
  pid: number;
  creationTime: number | null;
  type: string;
  memoryBytes: number;
  cpuPercent: number | null;
};

export type SampledMetrics = {
  cpuPercent: number | null;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  appMemoryBytes: number | null;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  sampledAt: string;
  cpuHighSeconds: number;
  memoryHighSeconds: number;
  processes: SampledProcess[];
  warnings: string[];
};

type Options = {
  userDataDir: string;
  appProcesses?: () => AppProcessMetric[];
  onProgress?: (sample: number, total: number) => void;
  signal?: AbortSignal;
};

function cpuTimes(): { idle: number; total: number } | null {
  try {
    let idle = 0;
    let total = 0;
    for (const core of os.cpus()) {
      idle += core.times.idle;
      total += Object.values(core.times).reduce((sum, value) => sum + value, 0);
    }
    return total > 0 ? { idle, total } : null;
  } catch {
    return null;
  }
}

function processes(read?: () => AppProcessMetric[]): SampledProcess[] {
  if (!read) return [];
  const unique = new Map<string, SampledProcess>();
  for (const metric of read()) {
    if (!Number.isInteger(metric.pid) || metric.pid <= 0) continue;
    const created = Number.isFinite(metric.creationTime) ? metric.creationTime! : null;
    const key = `${metric.pid}:${created ?? "unknown"}`;
    if (unique.has(key)) continue;
    const kb = metric.memory?.workingSetSize;
    const cpu = metric.cpu?.percentCPUUsage;
    unique.set(key, {
      pid: metric.pid,
      creationTime: created,
      type: String(metric.type || "unknown"),
      memoryBytes: Number.isFinite(kb) && kb! >= 0 ? Math.round(kb! * 1024) : 0,
      cpuPercent: Number.isFinite(cpu) && cpu! >= 0 ? cpu! : null,
    });
  }
  return [...unique.values()];
}

function waitOneSecond(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Análise cancelada"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 1000);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Análise cancelada"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

const inFlight = new Map<string, Promise<SampledMetrics>>();

/** One shared 15-second collector. CPU's first reading is only the baseline. */
export function collectOptimizerMetrics(options: Options): Promise<SampledMetrics> {
  const existing = inFlight.get(options.userDataDir);
  if (existing) return existing;
  const run = async (): Promise<SampledMetrics> => {
    const warnings: string[] = [];
    const first = cpuTimes();
    let previous = first;
    let cpuSum = 0;
    let cpuSamples = 0;
    let cpuHighSeconds = 0;
    let memoryHighSeconds = 0;
    let cpuStreak = 0;
    let memoryStreak = 0;
    let memoryUsedBytes = 0;
    let memoryTotalBytes = 0;
    let latestProcesses: SampledProcess[] = [];

    for (let sample = 1; sample <= 15; sample++) {
      await waitOneSecond(options.signal);
      const current = cpuTimes();
      if (previous && current && current.total > previous.total) {
        const value = 100 * (1 - (current.idle - previous.idle) / (current.total - previous.total));
        if (Number.isFinite(value)) {
          const percent = Math.max(0, Math.min(100, value));
          cpuSum += percent;
          cpuSamples++;
          cpuStreak = percent > 80 ? cpuStreak + 1 : 0;
          cpuHighSeconds = Math.max(cpuHighSeconds, cpuStreak);
        }
      }
      previous = current;
      memoryTotalBytes = os.totalmem();
      memoryUsedBytes = Math.max(0, memoryTotalBytes - os.freemem());
      memoryStreak = memoryTotalBytes > 0 && memoryUsedBytes / memoryTotalBytes > 0.85
        ? memoryStreak + 1 : 0;
      memoryHighSeconds = Math.max(memoryHighSeconds, memoryStreak);
      try { latestProcesses = processes(options.appProcesses); }
      catch { if (!warnings.includes("Processos do Workspace indisponíveis")) warnings.push("Processos do Workspace indisponíveis"); }
      options.onProgress?.(sample, 15);
    }

    if (!cpuSamples) warnings.push("Uso de CPU indisponível");
    if (!memoryTotalBytes) warnings.push("Memória do sistema indisponível");
    if (!options.appProcesses || latestProcesses.length === 0)
      warnings.push("Memória do Workspace indisponível");
    let diskFreeBytes: number | null = null;
    let diskTotalBytes: number | null = null;
    try {
      const disk = fs.statfsSync(options.userDataDir, { bigint: true });
      diskFreeBytes = Number(disk.bavail * disk.bsize);
      diskTotalBytes = Number(disk.blocks * disk.bsize);
    } catch { warnings.push("Espaço do disco do perfil indisponível"); }
    return {
      cpuPercent: cpuSamples ? Math.round(cpuSum / cpuSamples) : null,
      memoryUsedBytes,
      memoryTotalBytes,
      appMemoryBytes: options.appProcesses && latestProcesses.length > 0 &&
        !warnings.includes("Processos do Workspace indisponíveis")
        ? latestProcesses.reduce((sum, metric) => sum + metric.memoryBytes, 0) : null,
      diskFreeBytes,
      diskTotalBytes,
      sampledAt: new Date().toISOString(),
      cpuHighSeconds,
      memoryHighSeconds,
      processes: latestProcesses,
      warnings,
    };
  };
  const pending = run().finally(() => { inFlight.delete(options.userDataDir); });
  inFlight.set(options.userDataDir, pending);
  return pending;
}
