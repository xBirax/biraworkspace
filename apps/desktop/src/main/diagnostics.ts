import {buildId} from "./build-id.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { app } from "electron";
import { redactSecrets } from "./redact.js";
import { isAdrEndpoint } from "./personal-policy.js";

type TabFailure =
  | { event: "policy-block"; policy: "adr-domain" }
  | { event: "load-failed"; chromiumCode: number; chromiumError: string }
  | { event: "http-error"; httpStatus: number }
  | { event: "renderer-exited"; reason: Electron.RenderProcessGoneDetails["reason"]; exitCode: number };

type TabIncident = TabFailure & { at: string; viewId: number; kind: string; destination: string };

// No perfil pessoal, até um hostname arbitrário pode identificar um cliente.
function diagnosticDestination(url: string): string {
  if (isAdrEndpoint(url)) {
    return new URL(url).hostname === "app.adragencia.com.br" ? "app.adragencia.com.br" : "adragencia.com.br (grupo)";
  }
  if (url.startsWith("chrome-error:")) return "chrome-error";
  return /^https?:/i.test(url) ? "web" : "local/unknown";
}

export class TabDiagnostics {
  readonly incidents: TabIncident[] = [];

  record(viewId: number, kind: string, url: string, failure: TabFailure): void {
    this.incidents.push({ at: new Date().toISOString(), viewId, kind, destination: diagnosticDestination(url), ...failure });
    if (this.incidents.length > 100) this.incidents.shift();
  }

  watch(contents: Electron.WebContents, kind: string): void {
    const id = contents.id;
    contents.on("did-fail-load", (_event, code, description, url, main) => {
      if (!main || code === -3) return; // Navegação substituída ou cancelada pelo usuário.
      this.record(id, kind, url, {
        event: "load-failed", chromiumCode: code,
        chromiumError: /^ERR_[A-Z0-9_]{1,80}$/.test(description) ? description : "unknown",
      });
    });
    contents.on("did-navigate", (_event, url, status) => {
      if (status >= 400) this.record(id, kind, url, { event: "http-error", httpStatus: status });
    });
    contents.on("render-process-gone", (_event, details) => {
      this.record(id, kind, "", { event: "renderer-exited", reason: details.reason, exitCode: details.exitCode });
    });
  }
}

export type DiagnosticSnapshot = {
  exportedAt: string;
  appVersion: string;
  buildId: string;
  electron: string;
  chrome: string;
  appLocale: string;
  platform: string;
  arch: string;
  memGb: number;
  userData: string;
  settings: unknown;
  services: Array<{ id: string; kind: string; name: string; keepAwake: boolean }>;
  /** RAM por processo, do maior para o menor — sem isto, "quem come RAM" é chute. */
  processes: Array<{ type: string; name: string; ramMb: number }>;
  recentLogs: string[];
  tabIncidents: TabIncident[];
};

export function buildDiagnosticSnapshot(input: {
  minimal?: boolean;
  settings: unknown;
  services: Array<{ id: string; kind: string; name: string; keepAwake: boolean }>;
  recentLogs?: string[];
  tabIncidents: TabIncident[];
}): DiagnosticSnapshot {
  return {
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(), buildId:buildId(),
    electron: process.versions.electron || "",
    chrome: process.versions.chrome || "",
    appLocale: app.getLocale(),
    platform: process.platform,
    arch: process.arch,
    memGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    userData: input.minimal ? "[perfil local]" : app.getPath("userData"),
    settings: input.settings,
    services: input.minimal ? input.services.map((service, index) => ({ ...service, id: `servico-${index + 1}`, name: service.kind })) : input.services,
    // workingSetSize vem em KB.
    processes: app
      .getAppMetrics()
      .map((metric) => ({
        type: metric.type,
        name: input.minimal ? metric.type : metric.name || metric.serviceName || "",
        ramMb: Math.round(metric.memory.workingSetSize / 1024),
      }))
      .sort((left, right) => right.ramMb - left.ramMb),
    recentLogs: input.minimal ? [] : (input.recentLogs || []).map(redactSecrets),
    tabIncidents: input.tabIncidents.slice(),
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
