import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { app } from "electron";
import { redactSecrets } from "./redact.js";

export type DiagnosticSnapshot = {
  exportedAt: string;
  appVersion: string;
  electron: string;
  chrome: string;
  platform: string;
  arch: string;
  memGb: number;
  userData: string;
  settings: unknown;
  services: Array<{ id: string; kind: string; name: string; keepAwake: boolean }>;
  /** RAM por processo, do maior para o menor — sem isto, "quem come RAM" é chute. */
  processes: Array<{ type: string; name: string; ramMb: number }>;
  recentLogs: string[];
};

export function buildDiagnosticSnapshot(input: {
  settings: unknown;
  services: Array<{ id: string; kind: string; name: string; keepAwake: boolean }>;
  recentLogs?: string[];
}): DiagnosticSnapshot {
  return {
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    electron: process.versions.electron || "",
    chrome: process.versions.chrome || "",
    platform: process.platform,
    arch: process.arch,
    memGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    userData: app.getPath("userData"),
    settings: input.settings,
    services: input.services,
    // workingSetSize vem em KB.
    processes: app
      .getAppMetrics()
      .map((metric) => ({
        type: metric.type,
        name: metric.name || metric.serviceName || "",
        ramMb: Math.round(metric.memory.workingSetSize / 1024),
      }))
      .sort((left, right) => right.ramMb - left.ramMb),
    recentLogs: (input.recentLogs || []).map(redactSecrets),
  };
}

export function writeDiagnosticExport(
  snapshot: DiagnosticSnapshot,
  targetDir = app.getPath("downloads"),
): string {
  fs.mkdirSync(targetDir, { recursive: true });
  const file = path.join(
    targetDir,
    `adr-workspace-diagnostics-${snapshot.exportedAt.replace(/[:.]/g, "-")}.json`,
  );
  const body = redactSecrets(JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(file, body, { encoding: "utf8", mode: 0o600 });
  return file;
}
