import { app, BaseWindow, crashReporter, dialog, Menu, type WebContents } from "electron";
import {cleanVoiceTemp} from "./local-transcription.js";
import { backupsDirectory } from "./profile-backup.js";
import { migrateLegacyProfile } from "./legacy-profile.js";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { registerStartMenuShortcut, WINDOWS_APP_ID } from "./windows-taskbar.js";
import { createWorkspaceWindow, type ViewKind } from "./workspace-window.js";

// A identidade é definida antes do lock, das sessões e de qualquer leitura do perfil.
app.setName("BiraWorkspace");
const locale = "pt-BR";
app.commandLine.appendSwitch("lang", locale);
app.on("session-created", session => session.setUserAgent(session.getUserAgent(), locale));
if (process.platform==="linux") {app.commandLine.appendSwitch("class","BiraWorkspace");app.setDesktopName("biraworkspace.desktop");}
app.setPath("userData", !app.isPackaged && process.env["BIRA_TEST_PROFILE"]
  ? path.resolve(process.env["BIRA_TEST_PROFILE"])
  : path.join(app.getPath("appData"), app.isPackaged ? "BiraWorkspace" : "BiraWorkspace Dev"));
if (process.platform === "win32") app.setAppUserModelId(app.isPackaged ? WINDOWS_APP_ID : `${WINDOWS_APP_ID}.dev`);
// Antes de qualquer lock no perfil: traz as sessões do ADR Workspace instalado na mesma conta.
let legacyRunning = false;
if (process.platform === "linux" && app.isPackaged) {
  try {
    const migration = migrateLegacyProfile({ appData: app.getPath("appData"), target: app.getPath("userData"), appName: app.getName() });
    if (migration.status === "migrated") console.info(`Perfil do ADR Workspace copiado; chave do cofre: ${migration.keyring}`);
    legacyRunning = migration.status === "legacy-running";
  } catch (error) {
    console.error("Não foi possível copiar o perfil do ADR Workspace", error);
  }
}
if (process.platform === "linux") {
  const profile = app.getPath("userData");
  const backups = backupsDirectory(profile);
  fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
  const lockShared = (file: string) => {
    const fd = fs.openSync(file, "a+", 0o600);
    const result = spawnSync("/usr/bin/flock", ["--shared", "3"], { stdio: ["ignore", "ignore", "ignore", fd] });
    if (result.status !== 0) throw new Error("Não foi possível proteger o perfil durante o backup.");
    return fd;
  };
  // O copiador reserva a operação antes de pedir o fechamento. Uma nova
  // instância só abre o perfil depois da publicação ou da troca atômica.
  const admission = lockShared(path.join(backups, ".operation.lock"));
  lockShared(profile + ".backup.lock");
  fs.closeSync(admission);
}
crashReporter.start({ uploadToServer: false });
app.commandLine.appendSwitch("disk-cache-size", "104857600");
app.commandLine.appendSwitch("disable-features", "SpareRendererForSitePerProcess");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// O copiador abre o mesmo arquivo com FileShare.None. O sistema libera
// o descritor mesmo após uma queda. Esperar antes de abrir as sessões.
if (process.platform === "win32") {
  const file = app.getPath("userData") + ".backup.lock";
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try { fs.openSync(file, "a+"); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
      Atomics.wait(pause, 0, 0, 250);
    }
  }
}
const primary = app.requestSingleInstanceLock();
if (!primary) app.exit(0);
app.on("second-instance", () => {
  const win = BaseWindow.getAllWindows()[0];
  if (win?.isMinimized()) win.restore();
  win?.show();
  win?.focus();
});
let flushSessions: (() => Promise<void>) | undefined;
app.whenReady().then(() => {
  if (!primary) return;
  if (legacyRunning) {
    // Copiar um perfil aberto corromperia as sessões; nada é gravado nesta abertura.
    dialog.showMessageBoxSync({
      type: "info",
      title: "BiraWorkspace",
      message: "Feche o ADR Workspace para trazer suas contas",
      detail: "O BiraWorkspace copia as sessões do WhatsApp e os serviços do ADR Workspace na primeira abertura. Feche o ADR Workspace e abra o BiraWorkspace de novo.",
      buttons: ["OK"],
    });
    app.exit(0);
    return;
  }
  void cleanVoiceTemp().catch(()=>console.warn("Limpeza de áudio temporário indisponível"));
  try { registerStartMenuShortcut(); } catch (error) { console.warn("Atalho do menu Iniciar", error); }
  Menu.setApplicationMenu(null);
  createWorkspaceWindow({
    personal: true,
    dirname: path.join(app.getAppPath(), "dist", "main"),
    viewMeta: new WeakMap<WebContents, { kind: ViewKind; workspaceId: string; serviceId?: string }>(),
    setShowCrmSurface: () => undefined,
    setSaveGoogleContact: () => undefined,
    setScheduleMeeting: () => undefined,
    getCrmPanelKillSwitch: () => ({ enabled: false, reason: "personal" }),
    setCrmPanelKillSwitch: () => undefined,
    invalidateCrmSession: () => undefined,
    callCrmJson: async () => { throw new Error("Integrações ADR não estão disponíveis no BiraWorkspace."); },
    setFlushSessions: (fn) => { flushSessions = fn; },
  });
}).catch((error: unknown) => {
  console.error("Falha ao abrir BiraWorkspace", error);
  dialog.showErrorBox("BiraWorkspace", "Não foi possível abrir o aplicativo. Consulte o log local.");
  app.exit(1);
});
process.on("unhandledRejection", (error) => console.error("Falha assíncrona", error));
let quitting = false;
app.on("before-quit", (event) => {
  if (quitting || !flushSessions) return;
  quitting = true;
  event.preventDefault();
  void Promise.race([flushSessions(), new Promise((resolve) => setTimeout(resolve, 3000))]).finally(() => app.quit());
});
app.on("window-all-closed", () => app.quit());
