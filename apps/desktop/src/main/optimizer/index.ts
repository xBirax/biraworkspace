import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recommendedMaxLoadedViews } from "@adr/view-lifecycle";
import { collectOptimizerMetrics, type AppProcessMetric, type SampledMetrics } from "./metrics.js";
import { readLegacyBackup } from "./legacy.js";

export type OptimizerCategory = "workspace" | "startup" | "power" | "cleanup";
export type OptimizerItemStatus = "available" | "unavailable" | "applied";
export type OptimizerRunStatus = "pending" | "running" | "completed" | "partial" | "failed" | "cancelled" | "interrupted" | "restored";
export type OptimizerActionStatus = "pending" | "running" | "completed" | "partial" | "failed" | "cancelled" | "interrupted" | "restoring" | "restored";
export type OptimizerItem = {
  id: string;
  title: string;
  description: string;
  category: OptimizerCategory;
  reversible: boolean;
  requiresAdmin: boolean;
  estimatedBytes?: number;
  status: OptimizerItemStatus;
  reason?: string;
  evidence: string[];
  proposedChange: string;
  requiresRestart: boolean;
  scope: "workspace" | "user" | "system";
  preconditions: string[];
  executor: "workspace" | "native" | "none";
};
export type OptimizerOverview = {
  cpuPercent: number | null;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  appMemoryBytes: number | null;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  startupCount: number | null;
  activePowerScheme: string | null;
  workspace?: Record<string, number | string | boolean | null>;
  sampledAt: string;
  cpuHighSeconds: number;
  memoryHighSeconds: number;
  onBattery: boolean | null;
  batteryPercent: number | null;
};
export type OptimizerSnapshot = {
  id: string;
  createdAt: string;
  incomplete: boolean;
  overview: OptimizerOverview;
  recommendations: OptimizerItem[];
  cleanup: OptimizerItem[];
  warnings: string[];
};
export type OptimizerPreview = {
  id: string;
  snapshotId: string;
  createdAt: string;
  actions: OptimizerItem[];
  warnings: string[];
  irreversible: boolean;
};
export type OptimizerRunAction = Omit<OptimizerItem, "status"> & {
  status: OptimizerActionStatus;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  result?: Record<string, unknown>;
};
export type OptimizerRun = {
  id: string;
  previewId: string;
  createdAt: string;
  updatedAt: string;
  status: OptimizerRunStatus;
  actions: OptimizerRunAction[];
  error?: string;
  comparison?: { before: OptimizerOverview; after: OptimizerOverview; warnings: string[] };
};
export type OptimizerProgress = { runId: string; actionId?: string; status: OptimizerRunStatus | OptimizerActionStatus; message?: string };
export type OptimizerControllerOptions = {
  userDataDir: string;
  captureWorkspace?: () => Promise<Record<string, number | string | boolean | null>> | Record<string, number | string | boolean | null>;
  appProcesses?: () => AppProcessMetric[];
  hibernateEligible?: () => Promise<{ hibernated: number; skipped: number }>;
  setMaxLoadedViews?: (count: number) => Promise<void> | void;
  onProgress?: (event: OptimizerProgress) => void;
  /** Explicit executable path for development/tests; release builds resolve the packaged helper. */
  nativeExecutable?: string;
};

type NativeStartup = { name: string; run: string; approved: string | null; disabled: boolean; modifiable: boolean };
type NativeSnapshot = { startup: NativeStartup[]; power: { active: string | null; schemes: string[]; battery?: { onBattery: boolean | null; percent: number | null } } };
type CleanupScan = { id: string; files: number; bytes: number; scanned: number; ignored: number; limited: boolean };
type NativeReply = { ok: boolean; data: unknown; error?: string };
type PlanAction = { item: OptimizerItem; native?: NativeStartup; activePower?: string; beforeViews?: number; cleanupId?: string };
type StoredPreview = { public: OptimizerPreview; plans: PlanAction[] };

const RUN_DIR = "performance-runs";
const PREVIEW_TTL_MS = 10 * 60_000;
const NATIVE_TIMEOUT_MS = 70_000;
const MAX_REPORT_RUNS = 50;
const DISK_MIN_FREE_BYTES = 10 * 1024 ** 3;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function helperPath(): string {
  return process.env['NODE_ENV'] === "test"
    ? ""
    : path.join(process.resourcesPath, "optimizer-native", "adr-workspace-optimizer.exe");
}

function durableJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  try { const directory = fs.openSync(path.dirname(file), "r"); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); } } catch { /* Windows directory fsync is unavailable. */ }
}

function safeRun(raw: unknown): OptimizerRun | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<OptimizerRun>;
  if (typeof value.id !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id) || !Array.isArray(value.actions) || value.actions.length > 100) return null;
  if (value.actions.some((action) => !action || typeof action.id !== "string" || !["workspace", "startup", "power", "cleanup"].includes(action.category) || !["pending", "running", "completed", "partial", "failed", "cancelled", "interrupted", "restoring", "restored"].includes(action.status))) return null;
  return value as OptimizerRun;
}

function expectedDisabledStartup(approved: string | null): string | null {
  if (approved === null) return `3:03${"00".repeat(11)}`;
  const match = /^3:([0-9a-f]+)$/i.exec(approved);
  if (!match || match[1]!.length < 24 || match[1]!.length % 2 !== 0) return null;
  return `3:03${match[1]!.slice(2)}`.toLowerCase();
}

function statusFromActions(actions: OptimizerRunAction[]): OptimizerRunStatus {
  if (actions.some((action) => action.status === "pending" || action.status === "interrupted" || action.status === "running" || action.status === "restoring")) return "interrupted";
  if (actions.some((action) => action.status === "failed" || (action.status === "completed" && Boolean(action.error)))) return "failed";
  if (actions.some((action) => action.status === "partial")) return "partial";
  if (actions.some((action) => action.status === "cancelled")) return "cancelled";
  if (actions.every((action) => action.status === "restored")) return "restored";
  return "completed";
}

export function createOptimizerController(options: OptimizerControllerOptions) {
  const runDir = path.join(options.userDataDir, RUN_DIR);
  const nativeExecutable = options.nativeExecutable ?? helperPath();
  const runs = new Map<string, OptimizerRun>();
  const previews = new Map<string, StoredPreview>();
  let snapshot: OptimizerSnapshot | null = null;
  let nativeSnapshot: NativeSnapshot | null = null;
  let cleanupScan: CleanupScan | null = null;
  let activeRun: string | null = null;
  let activeChild: ChildProcess | null = null;
  let cancelRequested = false;
  let analysisAbort: AbortController | null = null;
  let analysisStarted = false;
  let queue: Promise<unknown> = Promise.resolve();
  let mutationToken: string | null = null;
  const lockFile = path.join(runDir, ".mutation.lock");
  function processIsAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; }
    catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
  }
  function recordMutationChild(pid: number): void {
    if (!mutationToken) return;
    const current = JSON.parse(fs.readFileSync(lockFile, "utf8")) as { pid?: number; token?: string; childPid?: number | null };
    if (current.token !== mutationToken) throw new Error("Lock do otimizador mudou durante a operação");
    const fd = fs.openSync(lockFile, "r+");
    try {
      const data = Buffer.from(JSON.stringify({ ...current, childPid: pid }));
      fs.writeSync(fd, data, 0, data.length, 0);
      fs.ftruncateSync(fd, data.length);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  }
  function acquireMutationLock(): () => void {
    fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
    const file = lockFile;
    const token = randomUUID();
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token, childPid: null }), { flag: "wx", mode: 0o600 });
    }
    catch { throw new Error("Outra execução ou lock pendente do otimizador; confira o estado antes de continuar"); }
    mutationToken = token;
    return () => {
      try {
        const current = JSON.parse(fs.readFileSync(file, "utf8")) as { token?: string };
        if (current.token === token) fs.rmSync(file, { force: true });
      } catch { /* Never remove another process's lock. */ }
      if (mutationToken === token) mutationToken = null;
    };
  }

  // A previous process can die between writing its journal and releasing the
  // lock. Keep a copy for audit, but never steal a lock from a live process.
  const orphanLock = lockFile;
  if (fs.existsSync(orphanLock)) {
    try {
      const owner = JSON.parse(fs.readFileSync(orphanLock, "utf8")) as { pid?: unknown; childPid?: unknown };
      if (typeof owner.pid === "number" && Number.isSafeInteger(owner.pid) && owner.pid > 0 &&
          (owner.childPid === null || (typeof owner.childPid === "number" && Number.isSafeInteger(owner.childPid) && owner.childPid > 0)) &&
          !processIsAlive(owner.pid) && (owner.childPid === null || !processIsAlive(owner.childPid))) {
        fs.renameSync(orphanLock, `${orphanLock}.orphan-${randomUUID()}`);
      }
    } catch { /* Unknown owner: keep the lock and fail closed. */ }
  }

  if (fs.existsSync(runDir)) {
    for (const name of fs.readdirSync(runDir).filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name))) {
      try {
        const run = safeRun(JSON.parse(fs.readFileSync(path.join(runDir, name), "utf8")));
        if (!run) continue;
        if (run.status === "running" || run.status === "pending") {
          run.status = "interrupted";
          for (const action of run.actions) if (action.status === "running" || action.status === "restoring") action.status = "interrupted";
          run.error = "Execução interrompida; consulte o estado atual antes de repetir.";
          run.updatedAt = new Date().toISOString();
          durableJson(path.join(runDir, name), run);
        }
        runs.set(run.id, run);
      } catch { /* A damaged historical entry must not block the current session. */ }
    }
  }

  function emit(run: OptimizerRun, action?: OptimizerRunAction, message?: string): void {
    options.onProgress?.({ runId: run.id, ...(action ? { actionId: action.id } : {}), status: action?.status ?? run.status, ...(message ? { message } : {}) });
  }
  function persist(run: OptimizerRun): void {
    run.updatedAt = new Date().toISOString();
    durableJson(path.join(runDir, `${run.id}.json`), run);
    runs.set(run.id, run);
    emit(run);
  }
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  async function native(command: Record<string, unknown>, onNativeProgress?: (deleted: number, bytes: number) => void): Promise<unknown> {
    if (process.platform !== "win32" || !nativeExecutable || !fs.existsSync(nativeExecutable)) throw new Error("Helper nativo indisponível");
    return new Promise((resolve, reject) => {
      const child = spawn(nativeExecutable, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false });
      activeChild = child;
      let stdout = ""; let stderr = ""; let stderrLineBuffer = ""; let settled = false;
      let forcedError: Error | null = null;
      const finish = (error?: Error, data?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (activeChild === child) activeChild = null;
        if (error) reject(error); else resolve(data);
      };
      const timeoutMs = command['op'] === "apply-cleanup" ? 5 * 60_000 : NATIVE_TIMEOUT_MS;
      const timer = setTimeout(() => { forcedError = new Error("Tempo esgotado no helper nativo"); child.kill(); }, timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => { stdout += String(chunk); if (stdout.length > 2_000_000 && !forcedError) { forcedError = new Error("Resposta nativa excedeu o limite"); child.kill(); } });
      child.stderr.on("data", (chunk: Buffer) => {
        const message = String(chunk);
        stderr = (stderr + message).slice(-4096);
        stderrLineBuffer += message;
        for (let newline = stderrLineBuffer.indexOf("\n"); newline >= 0; newline = stderrLineBuffer.indexOf("\n")) {
          const line = stderrLineBuffer.slice(0, newline).trim();
          stderrLineBuffer = stderrLineBuffer.slice(newline + 1);
          const progress = /^ADR_PROGRESS:(\d+):(\d+)$/.exec(line);
          if (progress) onNativeProgress?.(Number(progress[1]), Number(progress[2]));
        }
        if (stderrLineBuffer.length > 4096) stderrLineBuffer = stderrLineBuffer.slice(-4096);
      });
      child.on("error", (error) => {
        if (!child.pid) finish(error);
        else { forcedError = error; child.kill(); }
      });
      child.on("close", () => {
        if (forcedError) { finish(forcedError); return; }
        let reply: NativeReply;
        try { reply = JSON.parse(stdout) as NativeReply; }
        catch { finish(new Error(stderr || "Resposta nativa inválida")); return; }
        if (!reply.ok) finish(new Error(reply.error || "Helper nativo falhou"));
        else finish(undefined, reply.data);
      });
      try { if (child.pid) recordMutationChild(child.pid); }
      catch (error) { forcedError = error as Error; child.kill(); return; }
      // Helper que sai antes de ler (ou bloqueado pelo Smart App Control) dá EPIPE
      // no stdin; sem ouvinte vira exceção não tratada e o diálogo de erro do app.
      child.stdin.on("error", (error) => { forcedError ??= error; });
      child.stdin.end(JSON.stringify(command));
    });
  }

  function overview(metrics: SampledMetrics, workspace?: OptimizerOverview["workspace"]): OptimizerOverview {
    return {
      cpuPercent: metrics.cpuPercent, memoryUsedBytes: metrics.memoryUsedBytes, memoryTotalBytes: metrics.memoryTotalBytes,
      appMemoryBytes: metrics.appMemoryBytes, diskFreeBytes: metrics.diskFreeBytes, diskTotalBytes: metrics.diskTotalBytes,
      startupCount: nativeSnapshot?.startup.length ?? null,
      activePowerScheme: nativeSnapshot?.power.active ?? null, ...(workspace ? { workspace } : {}),
      sampledAt: metrics.sampledAt, cpuHighSeconds: metrics.cpuHighSeconds, memoryHighSeconds: metrics.memoryHighSeconds,
      onBattery: nativeSnapshot?.power.battery?.onBattery ?? null,
      batteryPercent: nativeSnapshot?.power.battery?.percent ?? null,
    };
  }

  function item(id: string, title: string, description: string, category: OptimizerCategory, reversible: boolean, status: OptimizerItemStatus, detail: {
    reason?: string; evidence?: string[]; proposedChange?: string; requiresRestart?: boolean; scope?: OptimizerItem["scope"];
    preconditions?: string[]; executor?: OptimizerItem["executor"];
  } = {}): OptimizerItem {
    return {
      id, title, description, category, reversible, requiresAdmin: false, status,
      evidence: detail.evidence ?? [], proposedChange: detail.proposedChange ?? description,
      requiresRestart: detail.requiresRestart ?? false,
      scope: detail.scope ?? (category === "power" ? "system" : category === "startup" || category === "cleanup" ? "user" : "workspace"),
      preconditions: detail.preconditions ?? [], executor: detail.executor ?? (category === "workspace" ? "workspace" : status === "unavailable" ? "none" : "native"),
      ...(detail.reason ? { reason: detail.reason } : {}),
    };
  }
  async function analyze(): Promise<OptimizerSnapshot> {
    if (analysisAbort) throw new Error("Análise já em andamento");
    const abort = new AbortController();
    analysisAbort = abort;
    return serial(async () => {
      if (abort.signal.aborted) { analysisAbort = null; throw new Error("Análise cancelada"); }
      analysisStarted = true;
      snapshot = null;
      previews.clear();
      try {
      const warnings: string[] = [];
      if (fs.existsSync(path.join(runDir, ".mutation.lock"))) warnings.push("Ações bloqueadas por execução anterior; examine o histórico e o estado atual antes de recuperar o lock");
      const legacy = readLegacyBackup();
      if (legacy.present) warnings.push("Backup do otimizador antigo encontrado; conteúdo não verificado e mantido intacto");
      warnings.push(...legacy.warnings);
      nativeSnapshot = null;
      cleanupScan = null;
      try { nativeSnapshot = await native({ op: "snapshot" }) as NativeSnapshot; }
      catch (error) { warnings.push((error as Error).message); }
      if (abort.signal.aborted) throw new Error("Análise cancelada");
      if (process.platform === "win32") {
        try {
          cleanupScan = await native({ op: "preview-cleanup" }, (scanned) =>
            options.onProgress?.({ runId: "analysis", status: "running", message: `Avaliando temporários: ${scanned} entradas` })) as CleanupScan;
          if (cleanupScan.limited) warnings.push("Varredura do Temp limitada a 100 mil entradas ou 60 segundos; limpeza indisponível nesta análise");
        } catch (error) { warnings.push(`Temporários indisponíveis: ${(error as Error).message}`); }
      }
      if (abort.signal.aborted) throw new Error("Análise cancelada");
      let workspace: OptimizerOverview["workspace"];
      try { workspace = await options.captureWorkspace?.(); } catch { warnings.push("Métricas do Workspace indisponíveis"); }
      const sampled = await collectOptimizerMetrics({ userDataDir: options.userDataDir, ...(options.appProcesses ? { appProcesses: options.appProcesses } : {}), signal: abort.signal,
        onProgress: (sample, total) => options.onProgress?.({ runId: "analysis", status: "running", message: `Amostra ${sample}/${total}` }),
      });
      warnings.push(...sampled.warnings);
      const metrics = overview(sampled, workspace);
      const recommendations: OptimizerItem[] = [];
      const cleanup: OptimizerItem[] = [];
      const idleLoaded = workspace?.['idleLoadedServices'];
      const activeLimit = workspace?.['maxLoadedViews'];
      const recommendedLimit = recommendedMaxLoadedViews(os.totalmem());
      if (options.hibernateEligible) recommendations.push(item("workspace:hibernate", "Suspender abas inativas", "Libera memória de abas elegíveis sem fechar a sessão. Elas reabrem sob demanda.", "workspace", false,
        typeof idleLoaded !== "number" ? "unavailable" : idleLoaded > 0 ? "available" : "applied",
        { evidence: typeof idleLoaded === "number" ? [`${idleLoaded} serviços carregados e inativos pelo critério de tempo`] : [],
          proposedChange: "Suspender apenas serviços que passem pela verificação de atividade e dados não salvos.",
          preconditions: ["Serviço inativo e sem mídia ou edição pendente"], ...(typeof idleLoaded !== "number" ? { reason: "Contagem de serviços inativos indisponível" } : {}) }));
      if (options.setMaxLoadedViews) recommendations.push(item("workspace:max-views", "Ajustar limite de abas em memória", `Usa o limite recomendado de ${recommendedLimit} abas para esta máquina.`, "workspace", true,
        typeof activeLimit !== "number" ? "unavailable" : activeLimit === recommendedLimit ? "applied" : "available",
        { evidence: typeof activeLimit === "number" ? [`Limite atual: ${activeLimit}; recomendado pela memória total: ${recommendedLimit}`] : [],
          proposedChange: `Definir limite de abas carregadas para ${recommendedLimit}.`, preconditions: ["Limite atual conhecido para permitir restauração"],
          ...(typeof activeLimit !== "number" ? { reason: "Limite atual indisponível" } : {}) }));
      if (metrics.cpuHighSeconds >= 10) recommendations.push(item("guidance:cpu", "CPU alta por tempo contínuo", "Investigue quais processos consumiram CPU antes de mudar configurações.", "workspace", false, "unavailable",
        { evidence: [`CPU acima de 80% por ${metrics.cpuHighSeconds} segundos consecutivos`], proposedChange: "Revisar processos e tarefas em execução.", executor: "none", reason: "Orientação sem alteração automática" }));
      if (metrics.memoryHighSeconds >= 10) recommendations.push(item("guidance:memory", "Memória alta por tempo contínuo", "Considere suspender abas inativas ou ajustar o limite de abas carregadas.", "workspace", false, "unavailable",
        { evidence: [`Memória usada acima de 85% por ${metrics.memoryHighSeconds} segundos consecutivos`], proposedChange: "Revisar as ações de abas disponíveis.", executor: "none", reason: "Orientação sem alteração automática" }));
      for (const entry of nativeSnapshot?.startup ?? []) {
        if (entry.disabled) continue;
        recommendations.push(item(`startup:${entry.name}`, `Inicialização: ${entry.name}`, "Desativa esta entrada apenas para o usuário atual. Pode ser restaurada.", "startup", true, entry.modifiable ? "available" : "unavailable",
          { evidence: [`Entrada HKCU Run detectada: ${entry.name}`], proposedChange: `Desativar ${entry.name} na próxima entrada deste usuário no Windows.`,
            requiresRestart: false, preconditions: ["Entrada atual deve permanecer igual à analisada"],
            ...(entry.modifiable ? {} : { reason: "Tipo de registro não suportado" }) }));
      }
      const active = nativeSnapshot?.power.active;
      for (const guid of nativeSnapshot?.power.schemes ?? []) {
        if (guid === active || !GUID.test(guid)) continue;
        recommendations.push(item(`power:${guid}`, `Plano de energia ${guid}`, "Seleciona um plano de energia já instalado. Pode ser restaurado.", "power", true, "available",
          { evidence: [`Plano instalado: ${guid}`, `Plano ativo: ${active ?? "desconhecido"}`,
              ...(nativeSnapshot?.power.battery?.onBattery === true ? [`Notebook na bateria${nativeSnapshot.power.battery.percent !== null ? `: ${nativeSnapshot.power.battery.percent}%` : ""}`] : [])], proposedChange: `Ativar o plano existente ${guid}.`,
            preconditions: ["Plano instalado e plano ativo devem permanecer iguais aos da prévia"] }));
      }
      if (process.platform === "win32") cleanup.push({ ...item("cleanup:user-temp", "Limpar temporários antigos", "Exclui definitivamente apenas arquivos elegíveis do Temp do usuário com mais de sete dias.", "cleanup", false,
        cleanupScan && !cleanupScan.limited && cleanupScan.files > 0 ? "available" : "unavailable",
        { reason: cleanupScan?.limited ? "Varredura limitada; tente novamente mais tarde" : cleanupScan?.files === 0 ? "Nenhum arquivo elegível encontrado" : "Temporários não puderam ser analisados",
          evidence: cleanupScan ? [`${cleanupScan.files} arquivos elegíveis; ${cleanupScan.ignored} ignorados; ${cleanupScan.scanned} entradas analisadas`,
            `Tamanho estimado elegível: ${Math.round(cleanupScan.bytes / 1024 ** 2)} MB`] : [],
          proposedChange: "Remover somente arquivos do Temp do usuário com mais de 7 dias, após confirmação explícita; limite de 100 mil itens e 60 segundos.",
          preconditions: ["Prévia atual e confirmação de exclusão definitiva"], executor: cleanupScan && !cleanupScan.limited && cleanupScan.files > 0 ? "native" : "none" }),
        ...(cleanupScan ? { estimatedBytes: cleanupScan.bytes } : {}) });
      if (metrics.diskFreeBytes !== null && (metrics.diskFreeBytes < DISK_MIN_FREE_BYTES || (metrics.diskTotalBytes !== null && metrics.diskTotalBytes > 0 && metrics.diskFreeBytes / metrics.diskTotalBytes < 0.1))) {
        const freeGb = Math.round(metrics.diskFreeBytes / 1024 ** 3);
        warnings.push("Espaço livre baixo no volume do perfil (<10 GB ou <10%).");
        cleanup.push(item("guidance:disk", "Pouco espaço no volume do perfil", "Revise arquivos pessoais e o uso do disco nas Configurações do Windows.", "cleanup", false, "unavailable",
          { evidence: [`${freeGb} GB livres no volume que contém os dados do Workspace`], proposedChange: "Abrir as opções de armazenamento do Windows para revisão manual.", executor: "none", reason: "Orientação sem exclusão automática" }));
      }
      snapshot = { id: randomUUID(), createdAt: new Date().toISOString(), incomplete: warnings.length > 0, overview: metrics, recommendations, cleanup, warnings };
      return snapshot;
      } finally { analysisStarted = false; if (analysisAbort === abort) analysisAbort = null; }
    });
  }
  function getSnapshot(): OptimizerSnapshot | null { return snapshot; }
  async function preview(ids: string[]): Promise<OptimizerPreview> {
    return serial(async () => {
    if (!snapshot) throw new Error("Execute a análise antes de preparar ações");
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error("Seleção inválida");
    const all = [...snapshot.recommendations, ...snapshot.cleanup];
    const workspaceBefore = ids.includes("workspace:max-views") ? await options.captureWorkspace?.() : undefined;
    const beforeViews = workspaceBefore?.['maxLoadedViews'];
    if (ids.includes("workspace:max-views") && (typeof beforeViews !== "number" || !Number.isInteger(beforeViews) || beforeViews < 1)) throw new Error("Limite atual indisponível para restauração");
    let verifiedCleanup: CleanupScan | null = null;
    if (ids.includes("cleanup:user-temp")) {
      if (!cleanupScan || cleanupScan.limited) throw new Error("Limpeza indisponível; analise novamente");
      verifiedCleanup = await native({ op: "preview-cleanup" }) as CleanupScan;
      if (verifiedCleanup.limited || verifiedCleanup.id !== cleanupScan.id || verifiedCleanup.bytes !== cleanupScan.bytes)
        throw new Error("Temporários mudaram desde a análise; analise novamente");
    }
    const plans: PlanAction[] = ids.map((id) => {
      const found = all.find((entry) => entry.id === id && entry.status === "available");
      if (!found) throw new Error(`Ação indisponível: ${id}`);
      const nativeEntry = nativeSnapshot?.startup.find((entry) => `startup:${entry.name}` === id);
      const activePower = nativeSnapshot?.power.active;
      return { item: found, ...(nativeEntry ? { native: nativeEntry } : {}), ...(activePower ? { activePower } : {}),
        ...(id === "workspace:max-views" && typeof beforeViews === "number" ? { beforeViews } : {}),
        ...(id === "cleanup:user-temp" && verifiedCleanup ? { cleanupId: verifiedCleanup.id } : {}) };
    });
    if (plans.filter((plan) => plan.item.category === "power").length > 1) throw new Error("Selecione apenas um plano de energia");
    if (plans.some((plan) => plan.item.category === "startup" || plan.item.category === "power")) {
      const current = await native({ op: "snapshot" }) as NativeSnapshot;
      for (const plan of plans) {
        if (plan.native) {
          const now = current.startup.find((entry) => entry.name === plan.native?.name);
          if (!now || now.run !== plan.native.run || now.approved !== plan.native.approved || now.disabled) throw new Error(`Entrada de inicialização mudou: ${plan.native.name}`);
        }
        if (plan.item.category === "power" && (!plan.activePower || current.power.active !== plan.activePower || !current.power.schemes.includes(plan.item.id.slice(6)))) throw new Error("Plano de energia mudou; analise novamente");
      }
    }
    const result: OptimizerPreview = {
      id: randomUUID(), snapshotId: snapshot.id, createdAt: new Date().toISOString(), actions: plans.map((plan) => plan.item),
      warnings: [
        ...(plans.some((plan) => plan.item.category === "cleanup") ? ["A limpeza de arquivos temporários é irreversível e exige confirmação explícita."] : []),
        ...(plans.some((plan) => plan.item.category === "power") && nativeSnapshot?.power.battery?.onBattery === true
          ? [`Notebook em bateria${nativeSnapshot.power.battery.percent !== null ? ` (${nativeSnapshot.power.battery.percent}%)` : ""}; a troca de plano pode reduzir a autonomia.`] : []),
        ...(plans.some((plan) => plan.item.category === "power") && nativeSnapshot?.power.battery?.onBattery == null
          ? ["Estado de bateria ou tomada indisponível; confira antes de trocar o plano."] : []),
      ],
      irreversible: plans.some((plan) => plan.item.category === "cleanup"),
    };
    previews.set(result.id, { public: result, plans });
    return result;
    });
  }

  async function executeAction(plan: PlanAction): Promise<Record<string, unknown>> {
    const id = plan.item.id;
    if (id === "workspace:hibernate") {
      if (!options.hibernateEligible) throw new Error("Suspensão indisponível");
      return await options.hibernateEligible();
    }
    if (id === "workspace:max-views") {
      if (!options.setMaxLoadedViews) throw new Error("Limite indisponível");
      const current = await options.captureWorkspace?.();
      const before = current?.['maxLoadedViews'];
      if (typeof before !== "number" || before !== plan.beforeViews) throw new Error("Limite de abas mudou; analise novamente");
      const target = recommendedMaxLoadedViews(os.totalmem());
      await options.setMaxLoadedViews(target);
      return { maxLoadedViews: target, before: { maxLoadedViews: before } };
    }
    if (id.startsWith("startup:")) {
      if (!plan.native) throw new Error("Entrada de inicialização indisponível");
      const result = await native({ op: "disable-startup", name: plan.native.name, expected_run: plan.native.run, expected_approved: plan.native.approved });
      return { ...(result as object), before: { run: plan.native.run, approved: plan.native.approved, name: plan.native.name } };
    }
    if (id.startsWith("power:")) {
      if (!plan.activePower || !GUID.test(id.slice(6))) throw new Error("Plano de energia indisponível");
      const result = await native({ op: "set-power", expected: plan.activePower, target: id.slice(6) });
      return { ...(result as object), before: { active: plan.activePower } };
    }
    if (id === "cleanup:user-temp") {
      if (!plan.cleanupId || !/^[0-9a-f]{64}$/i.test(plan.cleanupId)) throw new Error("Prévia de limpeza inválida");
      return await native({ op: "apply-cleanup", expected_id: plan.cleanupId, confirmed: true }, (deleted, bytesRemoved) =>
        options.onProgress?.({ runId: activeRun ?? "unknown", actionId: id, status: "running", message: `${deleted} arquivo(s) removido(s); ${Math.round(bytesRemoved / 1024 ** 2)} MB` })) as Record<string, unknown>;
    }
    throw new Error("Ação desconhecida");
  }

  async function apply(previewId: string, cleanupConfirmed: boolean): Promise<OptimizerRun> {
    return serial(async () => {
      const preview = previews.get(previewId);
      if (!preview || !snapshot || preview.public.snapshotId !== snapshot.id || Date.now() - Date.parse(preview.public.createdAt) > PREVIEW_TTL_MS) throw new Error("Prévia expirada; analise novamente");
      if (preview.public.irreversible && cleanupConfirmed !== true) throw new Error("Confirmação explícita da limpeza necessária");
      const release = acquireMutationLock();
      try {
      const beforeMetrics = snapshot.overview;
      previews.delete(previewId);
      const run: OptimizerRun = {
        id: randomUUID(), previewId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "pending",
        actions: preview.plans.map((plan) => ({ ...plan.item, status: "pending" })),
      };
      // Create a durable journal before any reversible or irreversible mutation.
      persist(run);
      activeRun = run.id; cancelRequested = false;
      run.status = "running"; persist(run);
      try {
        for (let i = 0; i < preview.plans.length; i++) {
          const action = run.actions[i]!;
          const plan = preview.plans[i]!;
          if (cancelRequested) { action.status = "cancelled"; persist(run); continue; }
          if (plan.native) action.result = { before: plan.native };
          else if (plan.activePower && action.category === "power") action.result = { before: { active: plan.activePower } };
          else if (action.id === "workspace:max-views") {
            const current = await options.captureWorkspace?.();
            const before = current?.['maxLoadedViews'];
            if (typeof before !== "number" || before !== plan.beforeViews) { action.status = "failed"; action.error = "Limite de abas mudou; analise novamente"; persist(run); continue; }
            action.result = { before: { maxLoadedViews: before }, target: recommendedMaxLoadedViews(os.totalmem()) };
          }
          action.status = "running"; action.startedAt = new Date().toISOString(); persist(run); emit(run, action);
          try {
            action.result = { ...action.result, ...await executeAction(plan) };
            action.status = action.result['partial'] === true ? "partial" : "completed";
          } catch (error) {
            action.status = action.category === "cleanup" || action.reversible ? "interrupted" : cancelRequested ? "cancelled" : "failed";
            action.error = `${(error as Error).message}${action.status === "interrupted" ? "; estado atual requer conferência" : ""}`;
          }
          action.endedAt = new Date().toISOString(); persist(run); emit(run, action);
        }
        run.status = run.actions.some((a) => a.status === "interrupted") ? "interrupted" : cancelRequested ? "cancelled" : run.actions.some((a) => a.status === "failed") ? "failed" : run.actions.some((a) => a.status === "partial") ? "partial" : "completed";
        persist(run);
        if (!cancelRequested && run.actions.some((action) => action.status === "completed" || action.status === "partial")) {
          try {
            const sampled = await collectOptimizerMetrics({ userDataDir: options.userDataDir, ...(options.appProcesses ? { appProcesses: options.appProcesses } : {}) });
            let workspace: OptimizerOverview["workspace"];
            try { workspace = await options.captureWorkspace?.(); } catch { /* Sample remains useful without app state. */ }
            const after = overview(sampled, workspace);
            run.comparison = { before: beforeMetrics, after, warnings: sampled.warnings };
            persist(run);
          } catch (error) { run.error = `Comparação posterior indisponível: ${(error as Error).message}`; persist(run); }
        }
      } finally { activeRun = null; activeChild = null; cancelRequested = false; snapshot = null; nativeSnapshot = null; cleanupScan = null; previews.clear(); }
      return publicRun(run);
      } finally { release(); }
    });
  }
  function publicRun(run: OptimizerRun): OptimizerRun {
    return { ...run, actions: run.actions.map((action) => {
      const result = action.result;
      if (!result) return { ...action };
      const { ['before']: _before, ['disabled']: _disabled, ...visible } = result;
      return { ...action, result: visible };
    }) };
  }
  function getRun(id: string): OptimizerRun | null { const run = runs.get(id); return run ? publicRun(run) : null; }
  async function cancel(id: string): Promise<OptimizerRun | null> {
    if (id === "analysis" && analysisAbort) {
      analysisAbort.abort();
      if (analysisStarted) activeChild?.kill();
      options.onProgress?.({ runId: "analysis", status: "cancelled", message: "Análise cancelada" });
      return null;
    }
    if (activeRun === id) { cancelRequested = true; activeChild?.kill(); }
    return getRun(id);
  }
  async function restore(runId: string, actionId: string): Promise<OptimizerRun> {
    return serial(async () => {
      const run = runs.get(runId);
      const action = run?.actions.find((entry) => entry.id === actionId);
      if (!run || !action || !action.reversible || !["completed", "interrupted"].includes(action.status)) throw new Error("Ação não restaurável");
      const release = acquireMutationLock();
      try {
      const result = action.result;
      const wasInterrupted = action.status === "interrupted";
      action.status = "restoring";
      run.status = "running";
      persist(run);
      try {
      if (action.category === "startup") {
        const before = result?.['before'] as NativeStartup | undefined;
        if (!before || typeof before.name !== "string" || typeof before.run !== "string" || !(before.approved === null || typeof before.approved === "string")) throw new Error("Registro de restauração incompleto");
        const current = (await native({ op: "snapshot" }) as NativeSnapshot).startup.find((entry) => entry.name === before.name);
        const expected = expectedDisabledStartup(before.approved);
        if (!current || current.run !== before.run || !expected) throw new Error("Entrada mudou; restauração automática indisponível");
        let disabled: string | null;
        if (current.approved === before.approved) disabled = null;
        else if (current.approved?.toLowerCase() === expected) disabled = current.approved;
        else throw new Error("Entrada alterada por outro programa; restauração automática indisponível");
        if (disabled !== null) {
          await native({ op: "restore-startup", name: before.name, expected_run: before.run, expected_disabled: disabled, previous_approved: before.approved });
        }
      } else if (action.category === "power") {
        const before = result?.['before'] as { active?: string } | undefined;
        if (!before?.active || !GUID.test(action.id.slice(6))) throw new Error("Registro de restauração incompleto");
        const current = (await native({ op: "snapshot" }) as NativeSnapshot).power.active;
        if (current?.toLowerCase() !== before.active.toLowerCase()) {
          if (current?.toLowerCase() !== action.id.slice(6).toLowerCase()) throw new Error("Plano alterado por outro programa; restauração automática indisponível");
          await native({ op: "set-power", expected: action.id.slice(6), target: before.active });
        }
      } else if (action.id === "workspace:max-views") {
        const before = result?.['before'] as { maxLoadedViews?: number } | undefined;
        if (!options.setMaxLoadedViews || typeof before?.maxLoadedViews !== "number") throw new Error("Registro de restauração incompleto");
        const current = await options.captureWorkspace?.();
        const target = wasInterrupted ? result?.['target'] : result?.['maxLoadedViews'];
        if (current?.['maxLoadedViews'] !== before.maxLoadedViews) {
          if (typeof target !== "number" || current?.['maxLoadedViews'] !== target) throw new Error("Limite de abas mudou; restauração automática indisponível");
          await options.setMaxLoadedViews(before.maxLoadedViews);
        }
      } else if (action.id === "workspace:hibernate") {
        throw new Error("Abas suspensas voltam ao abrir; restauração automática indisponível");
      }
      action.status = "restored"; action.endedAt = new Date().toISOString();
      delete action.error;
      run.status = statusFromActions(run.actions);
      persist(run); emit(run, action);
      return publicRun(run);
      } catch (error) {
        action.status = "interrupted";
        action.error = (error as Error).message;
        run.status = statusFromActions(run.actions);
        persist(run);
        throw error;
      }
      } finally { release(); }
    });
  }
  function history(offset = 0, limit = MAX_REPORT_RUNS): OptimizerRun[] {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REPORT_RUNS) throw new Error("Página de histórico inválida");
    return [...runs.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(offset, offset + limit).map(publicRun);
  }
  async function exportReport(): Promise<string> {
    const legacy = readLegacyBackup();
    const report = {
      format: "adr-workspace-performance-v1", generatedAt: new Date().toISOString(),
      methodology: {
        memory: "Memória usada estimada por total menos livre; Windows distingue memória livre de disponível.",
        disk: "Espaço do volume que contém os dados do Workspace, não soma de todas as unidades.",
        appMemory: "Soma do working set dos processos Electron reportados por app.getAppMetrics; valores em KB convertidos para bytes.",
      },
      snapshot: snapshot ? { ...snapshot, recommendations: snapshot.recommendations.map(({ id, title, status, category }) => ({ id, title, status, category })) } : null,
      runs: [...runs.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(publicRun),
      legacy: { ...legacy, entries: legacy.entries.map(({ original: _original, ...entry }) => entry) },
      mutationLock: {
        present: fs.existsSync(path.join(runDir, ".mutation.lock")),
        recovery: "Locks novos de processos encerrados são arquivados após conferir também o helper nativo. Locks antigos, danificados ou de processos ativos exigem conferência manual. Ações interrompidas só são restauradas após comparar o estado atual com o diário.",
      },
    };
    return JSON.stringify(report, null, 2);
  }
  return { analyze, getSnapshot, preview, apply, getRun, cancel, restore, history, exportReport };
}

export type OptimizerController = ReturnType<typeof createOptimizerController>;
