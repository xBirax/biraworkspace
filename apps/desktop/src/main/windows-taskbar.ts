import fs from "node:fs";
import path from "node:path";
import { app, shell, type BaseWindow } from "electron";

export const WINDOWS_APP_ID = "com.bira.workspace";

export function launchTarget(executable=process.execPath):string {
  const unpacked=path.dirname(executable), output=path.dirname(unpacked);
  if (path.basename(unpacked)!=="win-unpacked" || !/^release(?:-.+)?$/.test(path.basename(output))) return executable;
  const stable=path.join(path.dirname(output),"release","win-unpacked",path.basename(executable));
  return fs.existsSync(stable)?stable:executable;
}
function iconPath(): string {
  return path.join(process.resourcesPath, "biraworkspace.ico");
}

export function identifyTaskbarWindow(win: BaseWindow): void {
  if (process.platform !== "win32" || !app.isPackaged) return;
  win.setAppDetails({
    appId: WINDOWS_APP_ID,
    appIconPath: iconPath(),
    appIconIndex: 0,
    relaunchCommand: `"${launchTarget()}"`,
    relaunchDisplayName: "BiraWorkspace",
  });
}

export function registerStartMenuShortcut(): void {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const programs = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
  const shortcut = path.join(programs, "BiraWorkspace.lnk");
  const target = launchTarget();
  const icon = path.join(path.dirname(target),"resources","biraworkspace.ico");
  const exists = fs.existsSync(shortcut);
  if (exists) {
    const old = shell.readShortcutLink(shortcut);
    if (launchTarget(old.target).toLowerCase()!==target.toLowerCase()) return;
    if (old.target!==target && app.getLoginItemSettings({path:old.target}).openAtLogin) app.setLoginItemSettings({path:target,openAtLogin:true});
    if (old.target===target && old.icon === icon && old.iconIndex === 0 && old.appUserModelId === WINDOWS_APP_ID) return;
  }
  if (!shell.writeShortcutLink(shortcut, exists ? "update" : "create", {
    target, icon, iconIndex: 0, appUserModelId: WINDOWS_APP_ID, description: "BiraWorkspace",
  })) throw new Error("Falha ao registrar o atalho do BiraWorkspace no menu Iniciar");
}
