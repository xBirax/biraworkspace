import {
  app,
  dialog,
  shell,
  type DownloadItem,
  type Session,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  isRiskyExecutable,
  opensByDefault,
  releaseReservedDownloadPath,
  reserveUniqueDownloadPath,
  uniqueDownloadPath,
} from "./download-policy.js";

export type DownloadRow = {
  id: string;
  filename: string;
  savePath: string;
  receivedBytes: number;
  totalBytes: number;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
};

type Listener = (rows: DownloadRow[]) => void;

/**
 * Baixou e acabou: perguntar direto evita ir caçar o arquivo no gerenciador.
 *
 * Executável não ganha "Abrir" como botão padrão — nem como botão. Um anexo
 * `.exe` vindo de uma conversa virava dois cliques (baixar, Enter) até aqui.
 * Quem realmente quer rodar abre pela pasta, com o aviso do Windows no caminho.
 */
async function promptOpen(row: DownloadRow): Promise<void> {
  // Classify the actual saved path. A suggested name ending in a space/dot may
  // become an .exe after sanitizing even if its original extension looked safe.
  const risky = isRiskyExecutable(row.savePath);
  const buttons = risky ? ["Mostrar na pasta", "Fechar"] : ["Abrir", "Mostrar na pasta", "Fechar"];
  const { response } = await dialog.showMessageBox({
    type: risky ? "warning" : "info",
    buttons,
    // Enter só abre tipo inofensivo; o resto vai para "Mostrar na pasta".
    defaultId: risky ? 1 : opensByDefault(row.savePath) ? 0 : 1,
    cancelId: buttons.length - 1,
    title: "Download concluído",
    message: row.filename,
    ...(risky
      ? { detail: `${row.savePath}\n\nEste arquivo é executável. Abra só se souber a origem.` }
      : { detail: row.savePath }),
  });
  const choice = buttons[response];
  if (choice === "Abrir") {
    const error = await shell.openPath(row.savePath);
    if (error) {
      await dialog.showMessageBox({
        type: "error",
        title: "Não foi possível abrir o download",
        message: row.filename,
        detail: error,
      });
    }
  } else if (choice === "Mostrar na pasta") {
    shell.showItemInFolder(row.savePath);
  }
}

export class DownloadManager {
  private items = new Map<string, { row: DownloadRow; item: DownloadItem }>();
  private listeners = new Set<Listener>();
  private attached = new WeakSet<Session>();
  private readonly activeSavePaths = new Set<string>();
  private seq = 0;
  private emitTimer: NodeJS.Timeout | undefined;

  list(): DownloadRow[] {
    return [...this.items.values()].map((x) => ({ ...x.row }));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    clearTimeout(this.emitTimer);
    this.emitTimer = undefined;
    const rows = this.list();
    for (const fn of this.listeners) fn(rows);
  }

  /**
   * "updated" dispara a cada bloco recebido, e cada emit reenvia o estado
   * inteiro do shell (rail de todos os workspaces + painel) para quatro
   * renderers, que repintam tudo. Progresso pode esperar 250 ms; início, fim e
   * cancelamento continuam imediatos.
   */
  private emitProgress(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => this.emit(), 250);
  }

  cancel(id: string): boolean {
    const entry = this.items.get(id);
    if (!entry) return false;
    entry.item.cancel();
    entry.row.state = "cancelled";
    this.emit();
    return true;
  }

  /**
   * `askDestination` recebe o webContents que baixou: uma partição é
   * compartilhada por vários serviços (Gmail, YouTube, Browser), e decidir pelo
   * primeiro que chegou fazia o Gmail herdar o "perguntar onde salvar" do Browser.
   */
  attachSession(
    ses: Session,
    opts?: { askDestination?: (contents: unknown) => boolean },
  ): void {
    if (this.attached.has(ses)) return;
    this.attached.add(ses);
    ses.on("will-download", (_event, item, contents) => {
      const downloadsDir = app.getPath("downloads");
      const filename = item.getFilename() || "download";
      const askDestination = opts?.askDestination?.(contents) === true;
      const savePath = askDestination
        ? uniqueDownloadPath(downloadsDir, filename, fs.existsSync)
        : reserveUniqueDownloadPath(
            downloadsDir,
            filename,
            fs.existsSync,
            this.activeSavePaths,
          );

      // O destino TEM de ser decidido sem await: quando este handler retorna, o
      // Electron já seguiu com o comportamento padrão. A versão anterior fazia
      // `await dialog.showSaveDialog(...)` antes de `setSavePath`, e a escolha do
      // usuário chegava tarde demais. `setSaveDialogOptions` delega o diálogo ao
      // próprio Electron, que o abre na hora certa — e cancelar vira `done` com
      // state "cancelled", tratado abaixo.
      if (askDestination) {
        item.setSaveDialogOptions({ title: "Salvar download", defaultPath: savePath });
      } else {
        // A path remains reserved until this item completes, preventing two nearly
        // simultaneous downloads from both passing the existsSync check before
        // Chromium creates either file.
        item.setSavePath(savePath);
      }
      const id = `dl-${++this.seq}`;
      const row: DownloadRow = {
        id,
        filename: path.basename(savePath),
        savePath,
        receivedBytes: 0,
        totalBytes: item.getTotalBytes(),
        state: "progressing",
      };
      this.items.set(id, { row, item });
      // Sessão longa (o app fica aberto o dia todo) não pode acumular downloads
      // terminados para sempre: guarda os 50 mais recentes.
      if (this.items.size > 50) {
        for (const [key, entry] of this.items) {
          if (this.items.size <= 50) break;
          if (entry.row.state !== "progressing") this.items.delete(key);
        }
      }
      this.emit();

      // Com setSaveDialogOptions o caminho final só existe depois que o usuário
      // escolhe; até lá getSavePath() é vazio e o palpite acima é o que mostramos.
      const syncSavePath = (): void => {
        const chosen = item.getSavePath();
        if (!chosen || chosen === row.savePath) return;
        row.savePath = chosen;
        row.filename = chosen.split(/[/\\]/).pop() || row.filename;
      };
      item.on("updated", (_e, state) => {
        syncSavePath();
        row.receivedBytes = item.getReceivedBytes();
        row.totalBytes = item.getTotalBytes();
        if (state === "interrupted") row.state = "interrupted";
        else row.state = "progressing";
        if (state === "interrupted") this.emit();
        else this.emitProgress();
      });
      item.once("done", (_e, state) => {
        syncSavePath();
        if (!askDestination) releaseReservedDownloadPath(savePath, this.activeSavePaths);
        row.receivedBytes = item.getReceivedBytes();
        row.state =
          state === "completed" ? "completed" : state === "cancelled" ? "cancelled" : "interrupted";
        this.emit();
        if (row.state === "completed") {
          void promptOpen(row).catch((error) => {
            console.error("Falha ao mostrar download concluído", error);
          });
        }
      });
    });
  }
}
