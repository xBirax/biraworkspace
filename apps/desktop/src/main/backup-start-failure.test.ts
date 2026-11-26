import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { startBackupAndRestart } from "./profile-backup.js";
describe("confirmação do backup", () => {
  it("erro assíncrono do spawn não autoriza fechar o aplicativo", async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn(), kill: vi.fn() });
    const spawn = () => { queueMicrotask(() => child.emit("error", new Error("indisponível"))); return child; };
    const result = await startBackupAndRestart({userData:"fixture",scriptPath:"fixture.ps1",backupsRoot:"fixture",label:"manual",relaunch:""},{platform:"win32",exists:()=>true,spawn:spawn as never});
    expect(result.ok).toBe(false);
    expect(child.unref).not.toHaveBeenCalled();
  });
});
