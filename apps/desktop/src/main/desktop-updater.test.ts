import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopUpdater, UPDATE_STALL_MS, safeUpdaterError } from "./desktop-updater.js";

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowDowngrade = true;
  allowPrerelease = true;
  checkForUpdates = vi.fn(async () => null);
  quitAndInstall = vi.fn();
}

describe("DesktopUpdater", () => {
  afterEach(() => vi.useRealTimers());

  it("volta a verificar quando o download fica parado sem erro", async () => {
    vi.useFakeTimers();
    const port = new FakeUpdater();
    const updater = new DesktopUpdater(
      () => undefined,
      port as unknown as ConstructorParameters<typeof DesktopUpdater>[1],
      true,
      "win32",
      "1.0.0",
    );
    updater.start(60_000, 24 * 60 * 60 * 1000);
    port.emit("download-progress", { percent: 37 });
    await updater.check();
    expect(port.checkForUpdates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(UPDATE_STALL_MS);
    await updater.check();
    expect(port.checkForUpdates).toHaveBeenCalledTimes(1);
    updater.dispose();
  });

  it("does not re-emit downloaded on preparation failure and allows manual retry", async () => {
    vi.useFakeTimers();
    const port = new FakeUpdater();
    const states: string[] = [];
    const updater = new DesktopUpdater(
      (s) => states.push(s.phase),
      port as unknown as ConstructorParameters<typeof DesktopUpdater>[1],
      true,
      "win32",
      "1.0.0",
    );
    updater.start();
    port.emit("update-downloaded", { version: "1.1.0" });
    const onStuck = vi.fn();
    expect(
      await updater.install(async () => {
        throw new Error("disk full");
      }, onStuck),
    ).toMatchObject({ ok: false });
    expect(states.filter((s) => s === "downloaded")).toHaveLength(1);
    expect(updater.snapshot().phase).toBe("install-error");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onStuck).not.toHaveBeenCalled();
    expect(port.quitAndInstall).not.toHaveBeenCalled();
    expect(await updater.install(async () => undefined)).toMatchObject({ ok: true });
    updater.dispose();
  });

  it("times out preparation without installing later when the flush finally settles", async () => {
    vi.useFakeTimers();
    const port = new FakeUpdater();
    const updater = new DesktopUpdater(
      () => undefined,
      port as unknown as ConstructorParameters<typeof DesktopUpdater>[1],
      true,
      "win32",
      "1.0.0",
    );
    updater.start();
    port.emit("update-downloaded", { version: "1.1.0" });
    let finish!: () => void;
    const preparation = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const attempt = updater.install(() => preparation);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(updater.snapshot().phase).toBe("install-error");
    expect(await attempt).toMatchObject({ ok: false });
    finish();
    await Promise.resolve();
    expect(port.quitAndInstall).not.toHaveBeenCalled();
    updater.dispose();
  });
  it("stays disabled outside a packaged Windows build", async () => {
    const port = new FakeUpdater();
    const updater = new DesktopUpdater(
      () => undefined,
      port as unknown as ConstructorParameters<typeof DesktopUpdater>[1],
      false,
      "win32",
      "1.0.0",
    );
    updater.start();
    expect((await updater.check()).phase).toBe("disabled");
    expect(port.checkForUpdates).not.toHaveBeenCalled();
  });

  it("downloads automaticamente, prepara sessões e reinicia para instalar", async () => {
    vi.useFakeTimers();
    const port = new FakeUpdater();
    const states: string[] = [];
    const updater = new DesktopUpdater(
      (state) => states.push(state.phase),
      port as unknown as ConstructorParameters<typeof DesktopUpdater>[1],
      true,
      "win32",
      "1.0.0",
    );
    updater.start(100, 1000);
    expect(port.autoDownload).toBe(true);
    // Instalar sozinho ao sair é execução de código sem clique, e o pacote não é
    // assinado com Authenticode — o electron-updater não verifica o instalador.
    // Só volta a `true` quando houver assinatura.
    expect(port.autoInstallOnAppQuit).toBe(false);
    expect(port.allowDowngrade).toBe(false);
    expect(port.allowPrerelease).toBe(false);

    port.emit("update-available", { version: "1.1.0" });
    port.emit("download-progress", { percent: 42 });
    port.emit("update-downloaded", { version: "1.1.0" });
    const beforeInstall = vi.fn(async () => undefined);
    expect(await updater.install(beforeInstall)).toMatchObject({ ok: true });
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(port.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(updater.snapshot().phase).toBe("installing");
    expect(states).toContain("downloaded");
    updater.dispose();
    vi.useRealTimers();
  });

  it("reports the install as stuck when the app is still alive afterwards", async () => {
    vi.useFakeTimers();
    const port = new FakeUpdater();
    const updater = new DesktopUpdater(
      () => undefined,
      port as unknown as ConstructorParameters<typeof DesktopUpdater>[1],
      true,
      "win32",
      "1.0.0",
    );
    updater.start(100, 1000);
    port.emit("update-downloaded", { version: "1.1.0" });

    const onStuck = vi.fn();
    // quitAndInstall não devolve nada e não lança: sem este aviso, "cliquei em
    // Instalar e não aconteceu nada" não produzia sinal em lugar nenhum.
    await updater.install(undefined, onStuck, 5000);
    expect(onStuck).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(onStuck).toHaveBeenCalledOnce();
    // E o botão volta: a fase sai de "installing" e a instalação aceita retry.
    expect(updater.snapshot().phase).toBe("install-error");

    updater.dispose();
    vi.useRealTimers();
  });

  it("does not fire the stuck warning once disposed (the quit worked)", async () => {
    vi.useFakeTimers();
    const port = new FakeUpdater();
    const updater = new DesktopUpdater(
      () => undefined,
      port as unknown as ConstructorParameters<typeof DesktopUpdater>[1],
      true,
      "win32",
      "1.0.0",
    );
    updater.start(100, 1000);
    port.emit("update-downloaded", { version: "1.1.0" });

    const onStuck = vi.fn();
    await updater.install(undefined, onStuck, 5000);
    updater.dispose();
    vi.advanceTimersByTime(10_000);
    expect(onStuck).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not expose raw updater errors", () => {
    expect(safeUpdaterError(new Error("GET https://secret.invalid?token=abc 500"))).toBe(
      "Não foi possível concluir a atualização.",
    );
    expect(safeUpdaterError(new Error("net::ERR_NAME_NOT_RESOLVED"))).toMatch(/internet/);
  });
});
