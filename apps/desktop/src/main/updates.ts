import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  checkGithubUpdatesPure,
  shouldCheckForUpdatesAt,
  type UpdateCheckResult,
} from "./update-policy.js";

function statePath(): string {
  return path.join(app.getPath("userData"), "update-check.v1.json");
}

export function shouldCheckForUpdates(
  now = Date.now(),
  minIntervalMs = 24 * 60 * 60 * 1000,
): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), "utf8")) as { lastCheckAt?: number };
    return shouldCheckForUpdatesAt(raw.lastCheckAt, now, minIntervalMs);
  } catch {
    return true;
  }
}

export function markUpdateChecked(now = Date.now()): void {
  fs.writeFileSync(statePath(), JSON.stringify({ lastCheckAt: now }, null, 2), "utf8");
}

export async function checkGithubUpdates(opts?: {
  repo?: string;
  currentVersion?: string;
  fetchImpl?: typeof fetch;
}): Promise<UpdateCheckResult> {
  const args: {
    repo: string;
    currentVersion: string;
    fetchImpl?: typeof fetch;
  } = {
    repo: opts?.repo || process.env["ADR_UPDATE_REPO"] || "ADRAGENCIACRM/adrworkspace",
    currentVersion: opts?.currentVersion || app.getVersion(),
  };
  if (opts?.fetchImpl) args.fetchImpl = opts.fetchImpl;
  const result = await checkGithubUpdatesPure(args);
  if (result.ok) markUpdateChecked();
  return result;
}

export type { UpdateCheckResult };
