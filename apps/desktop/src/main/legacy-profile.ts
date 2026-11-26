import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Perfil deixado pelo ADR Workspace (app.setName("ADR Workspace")) na mesma conta.
export const LEGACY_PROFILE_NAME = "ADR Workspace";
export const MIGRATION_MARKER = ".migrado-do-adr-workspace.json";
const STATE_FILE = "state.v1.json";
// Locks e caches são recriados pelo Chromium; copiar os locks faria o perfil novo parecer aberto.
const SKIPPED = new Set(["SingletonLock", "SingletonCookie", "SingletonSocket", "Crashpad", "Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "ShaderCache", "GrShaderCache"]);

export type LegacyMigrationResult =
  | { status: "no-legacy" | "target-exists" }
  | { status: "legacy-running"; source: string }
  | { status: "migrated"; source: string; keyring: KeyringResult };

export type KeyringResult = "copied" | "already-present" | "unavailable";

export interface LegacyMigrationEnv {
  appData: string;
  target: string;
  /** Nome que o Electron usa para a chave do cofre (app.getName()). */
  appName: string;
  hostname?: string;
  isAlive?: (pid: number) => boolean;
  copyKeyring?: (from: string, to: string) => KeyringResult;
  now?: () => Date;
}

function hasState(dir: string): boolean {
  return fs.existsSync(path.join(dir, STATE_FILE));
}

function defaultIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** O Chromium grava SingletonLock como link simbólico "<host>-<pid>" enquanto o perfil está aberto. */
export function legacyProfileInUse(dir: string, hostname = os.hostname(), isAlive = defaultIsAlive): boolean {
  let target: string;
  try { target = fs.readlinkSync(path.join(dir, "SingletonLock")); }
  catch { return false; }
  const cut = target.lastIndexOf("-");
  const pid = Number(target.slice(cut + 1));
  if (cut <= 0 || !Number.isInteger(pid) || pid <= 0) return false;
  return target.slice(0, cut) === hostname && isAlive(pid);
}

/**
 * Copia a chave do cofre do sistema usada pelo Chromium para cifrar cookies e senhas.
 * O Electron registra a chave com o nome do aplicativo; sem esta cópia, os logins
 * do Google e de outros sites se perdem, mas o WhatsApp (IndexedDB) continua.
 */
export function copyLibsecretKey(from: string, to: string): KeyringResult {
  const tool = ["/usr/bin/secret-tool", "/bin/secret-tool"].find((candidate) => fs.existsSync(candidate));
  if (!tool) return "unavailable";
  const lookup = (application: string) => {
    const result = spawnSync(tool, ["lookup", "application", application], { encoding: "utf8", timeout: 15_000 });
    return result.status === 0 ? result.stdout : "";
  };
  if (lookup(to)) return "already-present";
  const secret = lookup(from);
  if (!secret) return "unavailable";
  const stored = spawnSync(tool, ["store", `--label=${to} Safe Storage`, "application", to], { input: secret, timeout: 15_000 });
  return stored.status === 0 ? "copied" : "unavailable";
}

/**
 * Na primeira abertura no Linux, traz o perfil do ADR Workspace (sessões do WhatsApp,
 * workspaces e serviços) para o BiraWorkspace. O original fica intacto.
 */
export function migrateLegacyProfile(env: LegacyMigrationEnv): LegacyMigrationResult {
  const source = path.join(env.appData, LEGACY_PROFILE_NAME);
  const target = path.resolve(env.target);
  if (hasState(target)) return { status: "target-exists" };
  if (path.resolve(source) === target || !hasState(source)) return { status: "no-legacy" };
  if (legacyProfileInUse(source, env.hostname, env.isAlive)) return { status: "legacy-running", source };

  const stamp = (env.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const staging = `${target}.migrando-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(source, staging, {
    recursive: true,
    verbatimSymlinks: true,
    preserveTimestamps: true,
    filter: (file) => path.dirname(file) !== source || !SKIPPED.has(path.basename(file)),
  });
  fs.chmodSync(staging, 0o700);
  fs.writeFileSync(path.join(staging, MIGRATION_MARKER), JSON.stringify({ from: source, at: stamp }, null, 2) + "\n", { mode: 0o600 });
  // Um diretório sem estado pode ter sido criado por uma abertura anterior; fica guardado ao lado.
  if (fs.existsSync(target)) fs.renameSync(target, `${target}.anterior-${stamp}`);
  fs.renameSync(staging, target);
  const keyring = (env.copyKeyring ?? copyLibsecretKey)(LEGACY_PROFILE_NAME, env.appName);
  return { status: "migrated", source, keyring };
}
