import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Backup do perfil (logins, cookies, estado, cofre).
 *
 * A cópia só é íntegra com o app FECHADO — com ele aberto, o banco de cookies e
 * o IndexedDB do WhatsApp mudam no meio da cópia. Por isso quem copia é
 * `build/backup-profile.ps1`, nunca este processo: o instalador o roda a cada
 * atualização (antes de a versão nova abrir o perfil), e o botão das
 * Configurações o agenda e fecha o app; o script espera o app sair, copia e o
 * reabre.
 */

/**
 * Onde ficam as cópias: %LOCALAPPDATA%ADR Workspace Backups. Em Roaming (ao
 * lado do perfil, como nas primeiras versões) um perfil móvel de empresa
 * sincronizaria GBs de backup a cada logon. Sem LOCALAPPDATA (fora do Windows),
 * ao lado do perfil.
 */
export function backupsDirectory(
  userData: string,
  localAppData: string | undefined = process.env["LOCALAPPDATA"],
): string {
  return localAppData
    ? path.join(localAppData, "ADR Workspace Backups")
    : `${path.resolve(userData)} Backups`;
}

/** Pasta das primeiras versões (Roaming, ao lado do perfil): ainda listada. */
export function legacyBackupsDirectory(userData: string): string {
  return `${path.resolve(userData)} Backups`;
}

export type ProfileBackup = {
  name: string;
  kind: "auto" | "manual" | "outro";
  createdAt: string;
  dir: string;
};

/** Cópias completas (com backup-info.json) das pastas dadas, mais nova primeiro. */
export function listProfileBackups(roots: readonly string[], limit = 20): ProfileBackup[] {
  const out: ProfileBackup[] = [];
  for (const root of new Set(roots)) {
    let names: string[];
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      const info = path.join(root, name, "backup-info.json");
      let createdAt = "";
      try {
        createdAt = fs.statSync(info).mtime.toISOString();
      } catch {
        continue; // cópia interrompida ou pasta alheia
      }
      const kind = name.startsWith("auto-") ? "auto" : name.startsWith("manual-") ? "manual" : "outro";
      out.push({ name, kind, createdAt, dir: root });
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export type BackupStatus = {
  state: "running" | "done" | "failed";
  label?: string;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
  target?: string;
  sizeBytes?: number;
  acknowledged?: boolean;
};

/** backup-status.json do script (UTF-8 com BOM do PowerShell 5.1), ou null. */
export function readBackupStatus(root: string): BackupStatus | null {
  try {
    const text = fs.readFileSync(path.join(root, "backup-status.json"), "utf8").replace(/^\uFEFF/, "");
    const data = JSON.parse(text) as BackupStatus;
    return data && typeof data.state === "string" ? data : null;
  } catch {
    return null;
  }
}

/** Marca a falha como já mostrada (o aviso aparece uma vez). */
export function acknowledgeBackupStatus(root: string, status: BackupStatus): void {
  try {
    fs.writeFileSync(path.join(root, "backup-status.json"), JSON.stringify({ ...status, acknowledged: true }));
  } catch {
    /* sem gravar, o aviso volta na próxima abertura: aceitável */
  }
}

/**
 * Uma cópia está acontecendo agora? Começou há menos de `maxAgeMs` e não
 * terminou. Abrir o app no meio dela faz o robocopy pegar arquivos presos.
 */
export function backupInProgress(status: BackupStatus | null, now = Date.now(), maxAgeMs = 30 * 60_000): boolean {
  if (!status || status.state !== "running" || !status.startedAt) return false;
  const started = Date.parse(status.startedAt);
  return Number.isFinite(started) && now - started < maxAgeMs;
}

/** "540 MB", "1,2 GB". */
export function formatBytes(bytes: number): string {
  if (!(bytes > 0)) return "0 MB";
  const mb = bytes / 1024 ** 2;
  // Arredonda antes de escolher a unidade: 1023,6 MB não vira "1024 MB".
  return Math.round(mb) < 1024 ? `${Math.max(1, Math.round(mb))} MB` : `${(mb / 1024).toFixed(1).replace(".", ",")} GB`;
}

/**
 * Aviso do último backup ainda não mostrado (1 por cópia): falha dos últimos 3
 * dias, ou cópia concluída nas últimas 24 h — com tamanho e onde ficou. O app
 * reabre depois do "Fazer backup agora" e antes ninguém dizia se deu certo.
 */
export function backupNoticeToShow(status: BackupStatus | null, now = Date.now()): string | null {
  const failure = backupFailureToShow(status, now);
  // O texto vem de um arquivo no disco: limitado, para não virar um aviso gigante.
  if (failure) return `Backup do perfil: ${failure.slice(0, 300)}`;
  if (!status || status.state !== "done" || status.acknowledged) return null;
  const finished = Date.parse(status.finishedAt ?? "");
  if (!Number.isFinite(finished) || now - finished > 24 * 60 * 60_000) return null;
  const size = typeof status.sizeBytes === "number" ? ` (${formatBytes(status.sizeBytes)})` : "";
  const kind = (status.label ?? "").startsWith("auto") ? "Cópia automática do perfil, antes da atualização," : "Backup do perfil";
  return `${kind} concluído${size}. Ver em Configurações → Geral → Abrir pasta.`;
}

/** Falha ainda não mostrada, dos últimos 3 dias. */
function backupFailureToShow(status: BackupStatus | null, now = Date.now()): string | null {
  if (!status || status.state !== "failed" || status.acknowledged) return null;
  const finished = Date.parse(status.finishedAt ?? "");
  if (!Number.isFinite(finished) || now - finished > 3 * 24 * 60 * 60_000) return null;
  return status.message || "A última cópia do perfil falhou.";
}

export type BackupRequest = {
  userData: string;
  scriptPath: string;
  /** Executável a reabrir depois da cópia ("" = não reabrir, ex.: pnpm dev). */
  relaunch: string;
  label: "manual";
  /** Pasta das cópias (backupsDirectory). */
  backupsRoot: string;
};

/** Argumentos do powershell.exe para o script (array: sem shell, sem aspas a escapar). */
export function backupScriptArgs(input: BackupRequest, pid: number): string[] {
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-File",
    input.scriptPath,
    "-ProfileDir",
    path.resolve(input.userData),
    "-Label",
    input.label,
    "-WaitPid",
    String(pid),
  ];
  args.push("-BackupsRoot", input.backupsRoot);
  if (input.relaunch) args.push("-Relaunch", input.relaunch);
  return args;
}

/**
 * Agenda o script de backup para depois de o app fechar. Quem chama fecha o app
 * logo em seguida (app.quit) — o script espera este processo sair.
 */
export function startBackupAndRestart(
  input: BackupRequest,
  env: {
    platform?: NodeJS.Platform;
    exists?: (file: string) => boolean;
    spawn?: typeof spawn;
    pid?: number;
  } = {},
): { ok: boolean; message: string } {
  if ((env.platform ?? process.platform) !== "win32") {
    return { ok: false, message: "Backup automático só no Windows" };
  }
  if (!(env.exists ?? fs.existsSync)(input.scriptPath)) {
    return { ok: false, message: "Script de backup não encontrado nesta instalação" };
  }
  try {
    const child = (env.spawn ?? spawn)("powershell.exe", backupScriptArgs(input, env.pid ?? process.pid), {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    child.on("error", () => undefined);
    child.unref();
  } catch (error) {
    return { ok: false, message: `Não foi possível iniciar o backup (${String(error)})` };
  }
  return { ok: true, message: "Backup agendado: o app vai fechar, copiar e reabrir." };
}
