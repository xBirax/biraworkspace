import fs from "node:fs";
import {secureStorageAvailable} from "./secure-storage.js";
import { dialog, safeStorage, shell, type BaseWindow } from "electron";
import type { AppSettings } from "@adr/contracts";
import { isGoogleCalendarIcsUrl } from "./calendar-reminders.js";
import { permissionName } from "./permission-policy.js";
import {
  acknowledgeBackupStatus,
  backupNoticeToShow,
  backupsDirectory,
  legacyBackupsDirectory,
  listProfileBackups,
  readBackupStatus,
  startBackupAndRestart,
} from "./profile-backup.js";

/**
 * Configurações → agenda do lembrete, permissões lembradas e backup do perfil.
 * Saiu de workspace-window.ts: depende só do que recebe em `deps`. As regras de
 * permissão (listar, revogar) são puras e testadas à parte.
 */

export type PermissionGrantRow = { key: string; origin: string; permission: string; label: string };

/** "Permitir" já dados, por site, para a tela de Privacidade. */
export function permissionGrantRows(grants: Readonly<Record<string, boolean>>): PermissionGrantRow[] {
  return Object.entries(grants)
    .filter(([, allowed]) => allowed === true)
    .map(([key]) => {
      const cut = key.lastIndexOf("|");
      const origin = cut > 0 ? key.slice(0, cut) : key;
      const permission = cut > 0 ? key.slice(cut + 1) : "";
      return { key, origin, permission, label: permissionName(permission) };
    })
    .sort((a, b) => a.origin.localeCompare(b.origin) || a.label.localeCompare(b.label));
}

/**
 * Permissões depois de revogar `key` ("*" = todas), ou null se a chave não
 * existe. Revogar microfone/câmera leva junto o "media" de antes da separação
 * (0.1.49), que valia para os dois — senão a revogação seria só no papel.
 */
export function revokeGrant(
  grants: Readonly<Record<string, boolean>>,
  key: string,
): Record<string, boolean> | null {
  if (key === "*") return {};
  if (!Object.prototype.hasOwnProperty.call(grants, key)) return null;
  const next = { ...grants };
  delete next[key];
  const legacy = key.replace(/\|media:(audio|video)$/, "|media");
  if (legacy !== key) delete next[legacy];
  return next;
}

export type ProfileIpcDeps = {
  handle: (channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: never[]) => unknown) => void;
  parentWindow: BaseWindow;
  settings: () => AppSettings;
  /** Aplica e grava a mudança nas configurações. */
  updateSettings: (change: (settings: AppSettings) => AppSettings) => void;
  refreshCalendar: () => Promise<{ ok: boolean; message: string; count: number }>;
  broadcast: () => void;
  notify: (text: string) => void;
  log: (message: string, extra?: unknown) => void;
  userData: string;
  /** backup-profile.ps1 desta instalação. */
  backupScriptPath: string;
  /** Executável a reabrir depois do backup ("" em pnpm dev). */
  relaunchPath: string;
  /** Sair sem instalar a atualização pendente (o backup reabre o app). */
  quitForBackup: () => void;
};

export function registerProfileIpc(deps: ProfileIpcDeps): void {
  const backupsRoot = (): string => backupsDirectory(deps.userData);

  /** Lembrete de reunião: guarda (cifrado) o endereço iCal secreto da agenda. */
  deps.handle("shell:set-calendar-feed", async (_event, value?: string) => {
    const url = String(value || "").trim();
    if (!url) {
      deps.updateSettings(({ calendarFeedSealed: _removed, ...rest }) => rest as AppSettings);
      await deps.refreshCalendar();
      deps.broadcast();
      return { ok: true, message: "Lembrete desligado", count: 0 };
    }
    if (!isGoogleCalendarIcsUrl(url)) {
      return {
        ok: false,
        message: 'Cole o "Endereço secreto no formato iCal" do Google Calendar (termina em basic.ics).',
        count: 0,
      };
    }
    if (!secureStorageAvailable(safeStorage)) {
      return { ok: false, message: "Desbloqueie o chaveiro do sistema para salvar a agenda.", count: 0 };
    }
    deps.updateSettings((settings) => ({
      ...settings,
      calendarFeedSealed: safeStorage.encryptString(url).toString("base64"),
    }));
    const result = await deps.refreshCalendar();
    deps.broadcast();
    return result;
  });

  deps.handle("shell:list-permission-grants", () => permissionGrantRows(deps.settings().permissionGrants));
  deps.handle("shell:revoke-permission-grant", (_event, key?: string) => {
    const next = typeof key === "string" ? revokeGrant(deps.settings().permissionGrants, key) : null;
    if (!next) return { ok: false };
    deps.updateSettings((settings) => ({ ...settings, permissionGrants: next }));
    deps.log("permissão revogada", { todas: key === "*" });
    return { ok: true };
  });

  /** Backup do perfil: fecha o app, copia com tudo fechado e reabre. */
  deps.handle("shell:list-backups", () =>
    listProfileBackups([backupsRoot(), legacyBackupsDirectory(deps.userData)]),
  );
  deps.handle("shell:open-backups", async () => {
    const dir = backupsRoot();
    fs.mkdirSync(dir, { recursive: true });
    const error = await shell.openPath(dir);
    return { ok: !error, message: error };
  });
  deps.handle("shell:restore-profile", async (_event, name?: string) => {
    if (process.platform !== "linux" || typeof name !== "string" ||
        !/^manual-[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$/.test(name) ||
        !listProfileBackups([backupsRoot()]).some(backup => backup.name === name)) {
      return { ok: false, message: "Selecione um backup Linux disponível." };
    }
    const { response } = await dialog.showMessageBox(deps.parentWindow, {
      type: "question", title: "Restaurar perfil", message: "Restaurar " + name + "?",
      detail: "O aplicativo fecha, verifica a cópia e reabre. O perfil atual fica guardado ao lado do perfil restaurado.",
      buttons: ["Cancelar", "Fechar e restaurar"], defaultId: 0, cancelId: 0,
    });
    if (response !== 1) return { ok: false, message: "Cancelado" };
    const started = await startBackupAndRestart({ userData: deps.userData, scriptPath: deps.backupScriptPath,
      relaunch: deps.relaunchPath, label: "manual", backupsRoot: backupsRoot(), restoreName: name });
    if (started.ok) deps.quitForBackup();
    return started.ok ? {ok: true, message: "Restauração agendada."} : started;
  });
  deps.handle("shell:backup-profile", async () => {
    if (!["win32", "linux"].includes(process.platform)) return {ok:false,message:"Backup indisponível neste sistema."};
    const { response } = await dialog.showMessageBox(deps.parentWindow, {
      type: "question",
      buttons: ["Cancelar", "Fechar, copiar e reabrir"],
      defaultId: 1,
      cancelId: 0,
      title: "Backup do perfil",
      message: "Fazer backup completo do perfil agora?",
      detail:
        "O BiraWorkspace fecha (gravando os logins), copia o perfil com tudo fechado — é o que garante uma cópia íntegra — e abre de novo sozinho. Leva alguns segundos.",
    });
    if (response !== 1) return { ok: false, message: "Cancelado" };
    const started = await startBackupAndRestart({
      userData: deps.userData,
      scriptPath: deps.backupScriptPath,
      relaunch: deps.relaunchPath,
      label: "manual",
      backupsRoot: backupsRoot(),
    });
    if (!started.ok) return started;
    deps.log("backup do perfil agendado", {});
    deps.quitForBackup();
    return started;
  });
}

/** Espera para o aviso do backup: a janela e os serviços já de pé. */
export const BACKUP_NOTICE_DELAY_MS = 8000;

/**
 * Resultado do último backup (instalador ou "Fazer backup agora"): avisa uma
 * vez — falha ou concluído, com o tamanho. Separado do registro dos handlers
 * para que registrar (nos testes) não arme timer que lê arquivos de verdade.
 */
export function showPendingBackupNotice(
  deps: Pick<ProfileIpcDeps, "parentWindow" | "userData" | "notify">,
): boolean {
  if (deps.parentWindow.isDestroyed()) return false;
  const root = backupsDirectory(deps.userData);
  const status = readBackupStatus(root);
  const notice = backupNoticeToShow(status);
  if (!notice || !status) return false;
  deps.notify(notice);
  acknowledgeBackupStatus(root, status);
  return true;
}
