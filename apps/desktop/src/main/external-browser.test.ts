import { shell } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { execFileSync, spawn } from "node:child_process";

vi.mock("node:child_process", () => ({ spawn: vi.fn(), execFileSync: vi.fn() }));
vi.mock("node:fs", () => ({ default: { existsSync: () => true } }));

vi.mock("electron", () => ({
  shell: { openExternal: vi.fn() },
}));

import { openInPreferredBrowser } from "./external-browser.js";

describe("openInPreferredBrowser", () => {
  beforeEach(() => {
    vi.mocked(shell.openExternal).mockReset();
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);
    vi.mocked(execFileSync).mockReset();
    vi.mocked(execFileSync).mockReturnValue("C:/synthetic-browser.exe");
    vi.mocked(spawn).mockReset();
  });

  it("usa diretamente o navegador padrão quando a preferência é auto", async () => {
    const result = await openInPreferredBrowser("https://example.com/", "auto");

    expect(result).toMatchObject({ ok: true, browser: "padrão do sistema" });
    expect(shell.openExternal).toHaveBeenCalledWith("https://example.com/");
    expect(execFileSync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(["brave", "chrome"] as const)("honors the explicit %s choice", async (prefer) => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child as unknown as ReturnType<typeof spawn>;
    });
    expect(await openInPreferredBrowser("https://example.com/", prefer)).toMatchObject({
      ok: true,
    });
    expect(spawn).toHaveBeenCalledWith("C:/synthetic-browser.exe", ["https://example.com/"], {
      detached: true,
      stdio: "ignore",
    });
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("reports async launch failure without overriding an explicit browser choice", async () => {
    const child = new EventEmitter();
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit("error", new Error("ENOENT")));
      return child as unknown as ReturnType<typeof spawn>;
    });
    expect(await openInPreferredBrowser("https://example.com/", "chrome")).toMatchObject({
      ok: false,
    });
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("reports a system browser error", async () => {
    vi.mocked(shell.openExternal).mockRejectedValue(new Error("unavailable"));
    expect(await openInPreferredBrowser("https://example.com/", "auto")).toMatchObject({
      ok: false,
    });
  });

  it("não abre URLs fora da allowlist", async () => {
    const result = await openInPreferredBrowser("javascript:alert(1)", "auto");

    expect(result).toEqual({ ok: false, message: "URL inválida" });
    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});
