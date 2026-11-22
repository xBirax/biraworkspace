import { app } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";

export type DesktopUpdatePhase =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "install-error"
  | "up-to-date"
  | "error";

export type DesktopUpdateState = {
  phase: DesktopUpdatePhase;
  currentVersion: string;
  latestVersion?: string | undefined;
  progressPercent?: number | undefined;
  message: string;
};

type UpdaterPort = Pick<
  typeof autoUpdater,
  | "on"
  | "removeAllListeners"
  | "checkForUpdates"
  | "quitAndInstall"
  | "autoDownload"
  | "autoInstallOnAppQuit"
  | "allowDowngrade"
  | "allowPrerelease"
>;

export function safeUpdaterError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/404|not found/i.test(message)) return "Nenhuma publicação de atualização foi encontrada.";
  if (/net::|network|ENOTFOUND|ECONN/i.test(message)) {
    return "Não foi possível consultar atualizações. Verifique a internet.";
  }
  return "Não foi possível concluir a atualização.";
}

/**
 * Sem nenhum evento do electron-updater por este tempo em "verificando" ou
 * "baixando", a etapa é tratada como travada e o check volta a valer — antes,
 * download parado sem "error" mostrava "Baixando… 37%" até reiniciar o app.
 */
export const UPDATE_STALL_MS = 15 * 60 * 1000;

export class DesktopUpdater {
  private state: DesktopUpdateState;
  private checkTimer: NodeJS.Timeout | undefined;
  private checkInterval: NodeJS.Timeout | undefined;
  private stuckTimer: NodeJS.Timeout | undefined;
  private started = false;
  private disposed = false;
  private lastChangeAt = Date.now();

  constructor(
    private readonly onState: (state: DesktopUpdateState) => void,
    private readonly updater: UpdaterPort = autoUpdater,
    private readonly packaged = app.isPackaged,
    private readonly platform = process.platform,
    currentVersion = app.getVersion(),
  ) {
    this.state = {
      phase: packaged && platform === "win32" ? "idle" : "disabled",
      currentVersion,
      message:
        packaged && platform === "win32"
          ? "Busca automática de versões estáveis ativa"
          : "Atualização automática disponível somente no aplicativo instalado para Windows",
    };
  }

  snapshot(): DesktopUpdateState {
    return { ...this.state };
  }

  private setState(patch: Partial<DesktopUpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.lastChangeAt = Date.now();
    this.onState(this.snapshot());
  }

  start(initialDelayMs = 12_000, intervalMs = 4 * 60 * 60 * 1000): void {
    if (this.started || this.state.phase === "disabled") {
      this.onState(this.snapshot());
      return;
    }
    this.started = true;
    this.updater.autoDownload = true;
    // Instalação parte do evento update-downloaded, depois de o electron-updater
    // conferir sha512. Não usar autoInstallOnAppQuit: este caminho precisa gravar
    // estado e sessões antes de encerrar o app.
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowDowngrade = false;
    this.updater.allowPrerelease = false;

    this.updater.on("checking-for-update", () => {
      this.setState({
        phase: "checking",
        progressPercent: undefined,
        message: "Verificando atualização…",
      });
    });
    this.updater.on("update-available", (info: UpdateInfo) => {
      this.setState({
        phase: "available",
        latestVersion: info.version,
        progressPercent: 0,
        message: `Versão ${info.version} encontrada. Preparando download…`,
      });
    });
    this.updater.on("download-progress", (progress: ProgressInfo) => {
      const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
      this.setState({
        phase: "downloading",
        progressPercent: percent,
        message: `Baixando atualização… ${percent}%`,
      });
    });
    this.updater.on("update-not-available", (info: UpdateInfo) => {
      this.setState({
        phase: "up-to-date",
        latestVersion: info.version,
        progressPercent: undefined,
        message: "Nenhuma atualização estável disponível. Versões de avaliação têm download separado.",
      });
    });
    this.updater.on("update-downloaded", (info: UpdateInfo) => {
      this.setState({
        phase: "downloaded",
        latestVersion: info.version,
        progressPercent: 100,
        message: `Versão ${info.version} pronta para instalar`,
      });
    });
    this.updater.on("error", (error: Error) => {
      this.setState({
        phase: "error",
        progressPercent: undefined,
        message: safeUpdaterError(error),
      });
    });

    this.checkTimer = setTimeout(() => void this.check(false), initialDelayMs);
    this.checkInterval = setInterval(() => void this.check(false), intervalMs);
  }

  async check(manual = true): Promise<DesktopUpdateState> {
    if (this.state.phase === "disabled") return this.snapshot();
    if (
      (this.state.phase === "checking" ||
        this.state.phase === "available" ||
        this.state.phase === "downloading") &&
      Date.now() - this.lastChangeAt < UPDATE_STALL_MS
    ) {
      return this.snapshot();
    }
    if (["downloaded", "installing", "install-error"].includes(this.state.phase))
      return this.snapshot();
    if (manual) {
      this.setState({
        phase: "checking",
        progressPercent: undefined,
        message: "Verificando atualização…",
      });
    }
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.setState({
        phase: "error",
        progressPercent: undefined,
        message: safeUpdaterError(error),
      });
    }
    return this.snapshot();
  }

  /**
   * Instalação adiada porque o app está em uso: se o usuário sair antes de ele
   * ficar ocioso, a atualização instala na saída (silenciosa, sem relançar). O
   * before-quit do app já grava estado e sessões — é o motivo de o padrão aqui
   * ser desligado, e por isso só liga depois de o download ser conferido.
   */
  installOnQuit(): void {
    if (this.state.phase === "downloaded") this.updater.autoInstallOnAppQuit = true;
  }

  /** Saída que não deve instalar (ex.: backup do perfil que reabre o app). */
  cancelInstallOnQuit(): void {
    this.updater.autoInstallOnAppQuit = false;
  }

  /**
   * `onStuck` é a rede do "cliquei em Instalar e não aconteceu nada".
   *
   * `quitAndInstall` não devolve nada e não lança: ele dispara o instalador e
   * pede `app.quit()`. Se o quit for barrado (qualquer `before-quit` com
   * preventDefault) ou se o spawn do instalador falhar no `.catch` assíncrono
   * de dentro do electron-updater, o usuário não recebe sinal nenhum — e nós
   * respondíamos "Reiniciando para instalar…" de qualquer jeito. Se ainda
   * estivermos vivos depois do prazo, o clique não funcionou.
   */
  async install(
    beforeInstall?: () => Promise<void>,
    onStuck?: () => void,
    stuckAfterMs = 15_000,
  ): Promise<{ ok: boolean; message: string }> {
    if (this.disposed || !["downloaded", "install-error"].includes(this.state.phase)) {
      return { ok: false, message: "Nenhuma atualização está pronta para instalar" };
    }
    this.setState({
      phase: "installing",
      message: "Salvando sessões e reiniciando para atualizar…",
    });
    let preparationTimer: NodeJS.Timeout | undefined;
    try {
      if (beforeInstall) {
        await Promise.race([
          beforeInstall(),
          new Promise<never>((_resolve, reject) => {
            preparationTimer = setTimeout(() => reject(new Error("preparation timeout")), 10_000);
          }),
        ]);
      }
      if (this.disposed) return { ok: false, message: "Aplicativo encerrado" };
    } catch {
      // Não emitir downloaded: a janela inicia a instalação automaticamente
      // nessa transição. Falhas de disco/flush precisam de retry explícito.
      if (!this.disposed)
        this.setState({
          phase: "install-error",
          message: "Não foi possível preparar a atualização. Tente instalar novamente.",
        });
      return { ok: false, message: "Não foi possível salvar sessões antes da atualização" };
    } finally {
      clearTimeout(preparationTimer);
    }
    // NSIS recebe /S: atualiza e relança sem reabrir tela de setup.
    try {
      this.updater.quitAndInstall(true, true);
    } catch {
      this.setState({
        phase: "install-error",
        message: "Não foi possível iniciar o instalador. Tente novamente.",
      });
      return { ok: false, message: "Não foi possível iniciar o instalador" };
    }
    // Ainda vivos depois do prazo: o reinício falhou. Sem voltar a fase, o
    // botão ficava em "Reiniciando…" desabilitado e `check()` ignorava tudo
    // até o usuário reabrir o app na mão.
    this.stuckTimer = setTimeout(() => {
      if (this.disposed) return;
      this.setState({
        phase: "install-error",
        message: "O reinício para atualizar não aconteceu. Tente instalar novamente.",
      });
      onStuck?.();
    }, stuckAfterMs);
    this.stuckTimer.unref?.();
    return { ok: true, message: "Reiniciando para instalar…" };
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.checkTimer);
    clearTimeout(this.stuckTimer);
    clearInterval(this.checkInterval);
    this.updater.removeAllListeners();
  }
}
