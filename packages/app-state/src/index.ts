import fs from "node:fs";
import path from "node:path";
import {
  appStateV1Schema,
  profileSchema,
  serviceKindSchema,
  type AppStateV1,
} from "@adr/contracts";

export function createEmptyAppState(): AppStateV1 {
  return {
    schemaVersion: 1,
    migrations: [],
    workspaces: [],
    services: [],
    profiles: [],
    settings: {
      theme: "system",
      sidebarExpanded: true,
      sidebarPosition: "left",
      browserToolbarPosition: "top",
      uiScale: 1,
      adBlockEnabled: true,
      adBlockAllowlist: [],
      preferredExternalBrowser: "auto",
      crmAudioMuted: false,
      whatsappLockEnabled: false,
      whatsappLockServiceIds: {},
      whatsappLockOnLeaveServiceIds: {},
      whatsappLockTimeoutMinutes: 30,
      whatsappLockTimeoutServiceMinutes: {},
      permissionGrants: {},
      clearedUnread: {},
      keepMessengersAwake: true,
      meetQuietNotifications: true,
      meetMiniWindow: true,
      meetMuteShortcut: true,
      meetLogToCrm: true,
      calendarReminderMinutes: 1,
      notifications: {
        enabled: true,
        respectWhatsAppMute: true,
        serviceEnabled: {},
        trayBadge: true,
        quietHours: false,
        quietFromHour: 19,
        quietToHour: 8,
      },
    },
    parkedServices: [],
    parkedProfiles: [],
  };
}

/**
 * Objetos que saíram do schema. O estado é tratado como imutável (todo update é
 * `parseAppState({...state, ...})`), então quem já passou por aqui não precisa
 * ser validado de novo no save — antes cada clique pagava duas validações zod
 * do estado inteiro no main thread. Objeto montado à mão continua validado.
 */
const validated = new WeakSet<AppStateV1>();

const KNOWN_SERVICE_KINDS = new Set<string>(serviceKindSchema.options);
const KNOWN_PROFILE_KINDS = new Set<string>(profileSchema.shape.kind.options);

type Entry = Record<string, unknown>;
const isEntry = (value: unknown): value is Entry =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Separa as entradas de tipo desconhecido (gravadas por versão mais nova) das
 * ativas, e devolve às ativas as estacionadas que esta versão já conhece.
 * Entrada malformada continua na lista ativa: o zod rejeita como sempre.
 */
function splitByKind(
  active: unknown,
  parked: unknown,
  known: Set<string>,
): { active: unknown[]; parked: Entry[]; restored: Entry[] } | null {
  const list: unknown[] = Array.isArray(active) ? active : [];
  const waiting = Array.isArray(parked) ? parked.filter(isEntry) : [];
  const unknownKind = (entry: unknown): entry is Entry =>
    isEntry(entry) && typeof entry["kind"] === "string" && !known.has(entry["kind"]);
  if (!waiting.length && !list.some(unknownKind)) return null;
  const ids = new Set(list.filter(isEntry).map((entry) => entry["id"]));
  const restored = waiting.filter((entry) => !unknownKind(entry) && !ids.has(entry["id"]));
  return {
    active: [...list.filter((entry) => !unknownKind(entry)), ...restored],
    parked: [...list.filter(unknownKind), ...waiting.filter(unknownKind)],
    restored,
  };
}

function parkUnknownKinds(raw: unknown): unknown {
  if (!isEntry(raw)) return raw;
  const services = splitByKind(raw["services"], raw["parkedServices"], KNOWN_SERVICE_KINDS);
  const profiles = splitByKind(raw["profiles"], raw["parkedProfiles"], KNOWN_PROFILE_KINDS);
  if (!services && !profiles) return raw;
  const next: Entry = { ...raw };
  if (profiles) {
    next["profiles"] = profiles.active;
    next["parkedProfiles"] = profiles.parked;
  }
  if (services) {
    next["services"] = services.active;
    next["parkedServices"] = services.parked;
    // A barra lateral lista serviceInstanceIds: id estacionado sai dela, id que
    // voltou entra no fim do workspace dele.
    const parkedIds = new Set(services.parked.map((entry) => entry["id"]));
    if (Array.isArray(raw["workspaces"])) {
      next["workspaces"] = raw["workspaces"].map((ws: unknown) => {
        if (!isEntry(ws) || !Array.isArray(ws["serviceInstanceIds"])) return ws;
        const kept = ws["serviceInstanceIds"].filter((id: unknown) => !parkedIds.has(id));
        const back = services.restored
          .filter((entry) => entry["workspaceId"] === ws["id"] && !kept.includes(entry["id"]))
          .map((entry) => entry["id"]);
        return { ...ws, serviceInstanceIds: [...kept, ...back] };
      });
    }
  }
  return next;
}

export function parseAppState(raw: unknown): AppStateV1 {
  const state = appStateV1Schema.parse(parkUnknownKinds(raw));
  validated.add(state);
  return state;
}

export type LoadStateResult =
  | { ok: true; state: AppStateV1; source: "primary" | "backup" }
  /** `locked`: o arquivo existe mas outro processo o segura (antivírus,
   *  indexador, instalador). Não é corrupção: não cair no backup nem recomeçar. */
  | { ok: false; error: string; locked?: true };

/** Erros de E/S que no Windows passam sozinhos (arquivo aberto por outro processo). */
const TRANSIENT_IO = new Set(["EBUSY", "EPERM", "EACCES", "EAGAIN"]);
const ioCode = (error: unknown): string =>
  String((error as NodeJS.ErrnoException | undefined)?.code ?? "");

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
let ioSleep: (ms: number) => void = sleepSync;

/**
 * Troca a espera entre tentativas de E/S (testes: sem dormir de verdade).
 * Devolve a anterior, para restaurar.
 */
export function setIoRetrySleep(sleep: (ms: number) => void): (ms: number) => void {
  const previous = ioSleep;
  ioSleep = sleep;
  return previous;
}

/** Repete `fn` em erro transitório de E/S (até ~1 s no total); outro erro sobe na hora. */
export function withIoRetry<T>(
  fn: () => T,
  attempts = 6,
  sleep: (ms: number) => void = ioSleep,
  codes: ReadonlySet<string> = TRANSIENT_IO,
): T {
  for (let attempt = 1; ; attempt++) {
    try {
      return fn();
    } catch (error) {
      if (attempt >= attempts || !codes.has(ioCode(error))) throw error;
      sleep(50 * attempt);
    }
  }
}

/**
 * Gravação: roda no main thread a cada mudança de configuração. Só o que passa
 * sozinho (arquivo preso por antivírus/indexador) e no máximo ~150 ms — pasta
 * sem permissão (EACCES) falha na hora, em vez de congelar a janela a cada save.
 */
const SAVE_RETRY_CODES: ReadonlySet<string> = new Set(["EBUSY", "EPERM"]);
const renameWithRetry = (from: string, to: string): void =>
  withIoRetry(() => fs.renameSync(from, to), 3, ioSleep, SAVE_RETRY_CODES);

export function loadAppState(filePath: string): LoadStateResult {
  const backupPath = `${filePath}.bak`;
  for (const [source, candidate] of [
    ["primary", filePath],
    ["backup", backupPath],
  ] as const) {
    if (!fs.existsSync(candidate)) continue;
    let text: string;
    try {
      text = withIoRetry(() => fs.readFileSync(candidate, "utf8"));
    } catch (error) {
      // Principal mais novo que não abre AGORA não pode perder para um .bak
      // mais velho: o save seguinte gravaria o backup por cima dele.
      if (source === "primary" && TRANSIENT_IO.has(ioCode(error))) {
        return { ok: false, error: `Estado em uso por outro processo (${ioCode(error)})`, locked: true };
      }
      continue;
    }
    try {
      const raw = JSON.parse(text);
      const state = parseAppState(raw);
      return { ok: true, state, source };
    } catch {
      // try next
    }
  }
  return { ok: false, error: "Nenhum estado válido encontrado" };
}

/**
 * Copia o estado e o backup ilegíveis para `<arquivo>.corrupt-<stamp>` antes de
 * o app recomeçar do zero. Sem isto o primeiro save grava o estado vazio e o
 * segundo promove esse vazio a `.bak` — e a configuração antiga some de vez
 * (ex.: downgrade com um campo que o schema antigo rejeita).
 *
 * Cópia, não rename: se copiar falhar, o original continua onde estava.
 */
export function quarantineAppStateFiles(filePath: string, stamp = Date.now()): string[] {
  const copies: string[] = [];
  for (const source of [filePath, `${filePath}.bak`]) {
    if (!fs.existsSync(source)) continue;
    const target = `${source}.corrupt-${stamp}`;
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    copies.push(target);
  }
  return copies;
}

/**
 * Grava com fsync antes de quem chama fazer o rename. Sem o fsync, queda de
 * energia logo após o rename pode deixar o arquivo do tamanho certo e zerado.
 * Exportado para os cofres do desktop (senhas, PIN) usarem o mesmo caminho.
 */
export function writeDurableFile(filePath: string, contents: string): void {
  const fd = fs.openSync(filePath, "w", 0o600);
  try {
    fs.writeFileSync(fd, contents, { encoding: "utf8" });
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Último conteúdo que ESTE processo gravou com sucesso em cada arquivo, e quando
 * o `.bak` foi rotacionado. O save roda no main thread a cada clique de
 * configuração: reler e validar o primary do disco e fazer dois fsyncs a cada
 * vez travava a UI em disco lento. O que gravamos já foi validado, então é ele
 * que vira backup — e o backup só precisa acompanhar de minuto em minuto.
 */
const lastWritten = new Map<string, { json: string; backupAt: number }>();
export const BACKUP_ROTATION_MS = 60_000;

export function saveAppStateAtomic(
  filePath: string,
  state: AppStateV1,
  now = Date.now(),
): void {
  const parsed = validated.has(state) ? state : parseAppState(state);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${now}.tmp`;
  const backupPath = `${filePath}.bak`;
  const json = `${JSON.stringify(parsed, null, 2)}\n`;
  const backupTmp = `${tmp}.bak`;
  const previous = lastWritten.get(filePath);
  const rotateBackup = !previous || now - previous.backupAt >= BACKUP_ROTATION_MS;
  let validPrimary: string | undefined;
  if (rotateBackup) {
    if (previous) {
      validPrimary = previous.json;
    } else {
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        parseAppState(JSON.parse(raw));
        validPrimary = raw;
      } catch {
        // Recovery must not promote a missing/corrupt primary over the good backup.
      }
    }
  }
  try {
    writeDurableFile(tmp, json);
    if (validPrimary !== undefined) {
      // Use the exact validated bytes and replace the backup atomically too.
      writeDurableFile(backupTmp, validPrimary);
      renameWithRetry(backupTmp, backupPath);
    }
    // rename-over-existing preserves the old primary until replacement succeeds.
    // MoveFileEx falha com EPERM/EBUSY enquanto antivírus ou indexador seguram o
    // destino; passa em milissegundos. Sem repetir, o save do boot derrubava a janela.
    renameWithRetry(tmp, filePath);
    lastWritten.set(filePath, {
      json,
      // Sem backup ainda: o próximo save com primary válido rotaciona na hora.
      backupAt: validPrimary !== undefined ? now : (previous?.backupAt ?? -Infinity),
    });
  } finally {
    for (const temporary of [tmp, backupTmp]) {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        /* original IO error wins */
      }
    }
  }
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows/NTFS ignores POSIX modes
  }
}
