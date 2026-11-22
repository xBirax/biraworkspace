import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appStateV1Schema, type AppStateV1 } from "@adr/contracts";
import {
  BACKUP_ROTATION_MS,
  createEmptyAppState,
  loadAppState,
  parseAppState,
  quarantineAppStateFiles,
  saveAppStateAtomic,
  setIoRetrySleep,
  withIoRetry,
} from "../src/index.js";

/** Diretórios temporários dos testes novos: apagados no fim de cada teste. */
const tempDirs: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("AppStateV1 persistence", () => {
  it("preserves the valid backup when replacement fails after recovery", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-state-recovery-"));
    const file = path.join(dir, "state.v1.json");
    const state = createEmptyAppState();
    saveAppStateAtomic(file, state);
    saveAppStateAtomic(file, state);
    fs.writeFileSync(file, "{corrupt", "utf8");
    expect(loadAppState(file)).toMatchObject({ ok: true, source: "backup" });
    const backup = fs.readFileSync(`${file}.bak`, "utf8");
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("EPERM simulated replacement failure");
    });
    try {
      expect(() => saveAppStateAtomic(file, state)).toThrow("EPERM");
      expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe(backup);
      expect(loadAppState(file)).toMatchObject({ ok: true, source: "backup" });
    } finally {
      rename.mockRestore();
    }
    saveAppStateAtomic(file, state);
    expect(loadAppState(file)).toMatchObject({ ok: true, source: "primary" });
  });
  it("preserves unreadable state and backup before the app starts from scratch", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-state-quarantine-"));
    const file = path.join(dir, "state.v1.json");
    fs.writeFileSync(file, '{"schemaVersion":99}', "utf8");
    fs.writeFileSync(`${file}.bak`, '{"schemaVersion":98}', "utf8");
    expect(loadAppState(file).ok).toBe(false);

    const copies = quarantineAppStateFiles(file, 42);
    expect(copies).toEqual([`${file}.corrupt-42`, `${file}.bak.corrupt-42`]);

    // O fluxo que destruía os dados: dois saves seguidos do estado vazio.
    saveAppStateAtomic(file, createEmptyAppState());
    saveAppStateAtomic(file, createEmptyAppState());
    expect(fs.readFileSync(`${file}.corrupt-42`, "utf8")).toBe('{"schemaVersion":99}');
    expect(fs.readFileSync(`${file}.bak.corrupt-42`, "utf8")).toBe('{"schemaVersion":98}');
    expect(quarantineAppStateFiles(path.join(dir, "absent.json"))).toEqual([]);
  });

  it("quarantines both files when only the backup is valid (load came from backup)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-state-quarantine-backup-"));
    const file = path.join(dir, "state.v1.json");
    saveAppStateAtomic(file, createEmptyAppState());
    saveAppStateAtomic(file, createEmptyAppState());
    const backup = fs.readFileSync(`${file}.bak`, "utf8");
    fs.writeFileSync(file, '{"schemaVersion":99}', "utf8");
    expect(loadAppState(file)).toMatchObject({ ok: true, source: "backup" });

    expect(quarantineAppStateFiles(file, 7)).toEqual([`${file}.corrupt-7`, `${file}.bak.corrupt-7`]);
    expect(fs.readFileSync(`${file}.corrupt-7`, "utf8")).toBe('{"schemaVersion":99}');
    expect(fs.readFileSync(`${file}.bak.corrupt-7`, "utf8")).toBe(backup);
    // Os originais ficam onde estavam, e o mesmo carimbo não sobrescreve cópia anterior.
    expect(loadAppState(file)).toMatchObject({ ok: true, source: "backup" });
    expect(() => quarantineAppStateFiles(file, 7)).toThrow(/EEXIST/);
  });

  it("rotates the backup at most once per interval without rereading the primary", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-state-rotation-"));
    const file = path.join(dir, "state.v1.json");
    const named = (name: string) => {
      const state = createEmptyAppState();
      state.settings.contactsGoogleAccount = name;
      return state;
    };
    const backupAccount = () =>
      JSON.parse(fs.readFileSync(`${file}.bak`, "utf8")).settings.contactsGoogleAccount;
    saveAppStateAtomic(file, named("a"), 1_000);
    saveAppStateAtomic(file, named("b"), 2_000);
    expect(backupAccount()).toBe("a");

    const read = vi.spyOn(fs, "readFileSync");
    try {
      saveAppStateAtomic(file, named("c"), 3_000);
      saveAppStateAtomic(file, named("d"), 4_000);
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
    // Dentro do intervalo o .bak não muda; depois dele, recebe o último gravado.
    expect(backupAccount()).toBe("a");
    saveAppStateAtomic(file, named("e"), 2_000 + BACKUP_ROTATION_MS);
    expect(backupAccount()).toBe("d");
    expect(loadAppState(file)).toMatchObject({
      ok: true,
      state: { settings: { contactsGoogleAccount: "e" } },
    });
  });

  it("validates hand-built state on save but not state that already came from the schema", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-state-validated-"));
    const file = path.join(dir, "state.v1.json");
    // Montado à mão e inválido: o save ainda recusa.
    const invalid = { ...createEmptyAppState(), schemaVersion: 99 } as unknown as AppStateV1;
    expect(() => saveAppStateAtomic(file, invalid)).toThrow();
    expect(fs.existsSync(file)).toBe(false);

    const parsed = parseAppState(createEmptyAppState());
    // Espiona o schema, não o JSON.parse: o zod nunca chama JSON.parse, então
    // aquele espião passava mesmo sem o atalho.
    const parse = vi.spyOn(appStateV1Schema, "parse");
    try {
      // Primeiro save sem arquivo: nada a reler, e o estado já validado não é re-parseado.
      saveAppStateAtomic(file, parsed);
      expect(parse).not.toHaveBeenCalled();
      // Controle: o espião enxerga a validação do estado montado à mão.
      saveAppStateAtomic(path.join(dir, "other.json"), createEmptyAppState());
      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
    }
    expect(loadAppState(file)).toMatchObject({ ok: true, source: "primary" });
  });

  it("adds safe browser defaults to older state files", () => {
    const legacyState = createEmptyAppState();
    const {
      sidebarPosition: _sidebarPosition,
      browserToolbarPosition: _browserToolbarPosition,
      adBlockEnabled: _adBlockEnabled,
      adBlockAllowlist: _adBlockAllowlist,
      preferredExternalBrowser: _preferredExternalBrowser,
      crmAudioMuted: _crmAudioMuted,
      whatsappLockEnabled: _whatsappLockEnabled,
      whatsappLockServiceIds: _whatsappLockServiceIds,
      whatsappLockOnLeaveServiceIds: _whatsappLockOnLeaveServiceIds,
      whatsappLockTimeoutMinutes: _whatsappLockTimeoutMinutes,
      whatsappLockTimeoutServiceMinutes: _whatsappLockTimeoutServiceMinutes,
      ...legacySettings
    } = legacyState.settings;

    const settings = parseAppState({
      ...legacyState,
      settings: legacySettings,
    }).settings;

    expect(settings.sidebarPosition).toBe("left");
    expect(settings.browserToolbarPosition).toBe("top");
    expect(settings.adBlockEnabled).toBe(true);
    expect(settings.adBlockAllowlist).toEqual([]);
    expect(settings.preferredExternalBrowser).toBe("auto");
    // Estado gravado antes do mudo do CRM tem de continuar carregando.
    expect(settings.crmAudioMuted).toBe(false);
    expect(settings.whatsappLockEnabled).toBe(false);
    expect(settings.whatsappLockServiceIds).toEqual({});
    expect(settings.whatsappLockOnLeaveServiceIds).toEqual({});
    expect(settings.whatsappLockTimeoutMinutes).toBe(30);
    expect(settings.whatsappLockTimeoutServiceMinutes).toEqual({});
  });

  it("writes atomically with 0600 and recovers from truncated primary via backup", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-state-"));
    const file = path.join(dir, "state.v1.json");
    const state = createEmptyAppState();
    state.workspaces.push({
      id: "w1",
      name: "Ops",
      color: "#4da3ff",
      crmProfileId: "crm1",
      serviceInstanceIds: [],
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
    });

    saveAppStateAtomic(file, state);
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(fs.existsSync(file)).toBe(true);

    // Second save must replace in place (Windows rename-over-existing). Sem o
    // conteúdo conferido, o teste passava mesmo se o rename não sobrescrevesse.
    saveAppStateAtomic(file, {
      ...state,
      activeWorkspaceId: "w1",
    });
    expect(fs.existsSync(file)).toBe(true);
    expect(loadAppState(file)).toMatchObject({ ok: true, state: { activeWorkspaceId: "w1" } });
    // Nenhum .tmp sobrando: rename direto, sem unlink no meio.
    expect(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);

    fs.writeFileSync(file, "{truncated", "utf8");
    const loaded = loadAppState(file);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.source).toBe("backup");
      expect(loaded.state.workspaces[0]?.id).toBe("w1");
    }
  });

  it("persists different WhatsApp lock timeouts without coupling the accounts", () => {
    const state = createEmptyAppState();
    state.settings.whatsappLockTimeoutServiceMinutes = { "wa-1": 5, "wa-2": 0, "wa-3": 120 };
    expect(parseAppState(state).settings.whatsappLockTimeoutServiceMinutes).toEqual({
      "wa-1": 5,
      "wa-2": 0,
      "wa-3": 120,
    });
  });
});

describe("tipos desconhecidos (arquivo de versão mais nova)", () => {
  const withServices = () => {
    const state = createEmptyAppState();
    const ws = {
      id: "w1",
      name: "Principal",
      color: "#000",
      crmProfileId: "crm",
      serviceInstanceIds: ["s-wa", "s-new"],
      crmPosition: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const service = (id: string, kind: string) => ({
      id,
      workspaceId: "w1",
      kind,
      name: id,
      startUrl: "https://example.com/",
      profileId: `p-${id}`,
      pinned: false,
      keepAwake: false,
    });
    return {
      ...state,
      workspaces: [ws],
      services: [service("s-wa", "whatsapp"), service("s-new", "servico-do-futuro")],
      profiles: [
        { id: "p-new", kind: "perfil-do-futuro", name: "x", partitionName: "persist:x", createdAt: "" },
      ],
    };
  };

  it("estaciona o serviço desconhecido em vez de rejeitar o arquivo inteiro", () => {
    const state = parseAppState(withServices());
    expect(state.services.map((s) => s.id)).toEqual(["s-wa"]);
    expect(state.workspaces[0]!.serviceInstanceIds).toEqual(["s-wa"]);
    expect(state.parkedServices.map((s) => s["id"])).toEqual(["s-new"]);
    expect(state.parkedProfiles.map((p) => p["id"])).toEqual(["p-new"]);
  });

  it("devolve o serviço quando uma versão que conhece o tipo abre o arquivo", () => {
    const parked = parseAppState(withServices());
    const later = JSON.parse(JSON.stringify(parked).replace(/servico-do-futuro/g, "tiktok"));
    const state = parseAppState(later);
    expect(state.services.map((s) => s.id)).toEqual(["s-wa", "s-new"]);
    expect(state.workspaces[0]!.serviceInstanceIds).toEqual(["s-wa", "s-new"]);
    expect(state.parkedServices).toEqual([]);
  });

  it("sobrevive a gravar e reler", () => {
    const dir = tempDir("adr-state-parked-");
    const file = path.join(dir, "state.v1.json");
    fs.writeFileSync(file, JSON.stringify(withServices()), "utf8");
    const loaded = loadAppState(file);
    expect(loaded).toMatchObject({ ok: true, source: "primary" });
    if (!loaded.ok) return;
    saveAppStateAtomic(file, loaded.state);
    const again = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(again.parkedServices[0].kind).toBe("servico-do-futuro");
  });

  it("guarda campos de versão mais nova ao gravar e reler", () => {
    const file = path.join(tempDir("adr-state-passthrough-"), "state.v1.json");
    const raw = { ...createEmptyAppState(), campoNovo: 1 } as unknown;
    saveAppStateAtomic(file, parseAppState(raw));
    const loaded = loadAppState(file);
    expect(loaded.ok && (loaded.state as AppStateV1 & { campoNovo?: number }).campoNovo).toBe(1);
  });
});

describe("arquivo preso por outro processo", () => {
  // As tentativas esperam 50/100/150 ms de verdade; aqui só contam.
  const waits: number[] = [];
  let restore: ((ms: number) => void) | undefined;
  beforeEach(() => {
    waits.length = 0;
    restore = setIoRetrySleep((ms) => void waits.push(ms));
  });
  afterEach(() => {
    if (restore) setIoRetrySleep(restore);
  });

  it("não cai no backup mais velho quando o principal está em uso", () => {
    const dir = tempDir("adr-state-busy-");
    const file = path.join(dir, "state.v1.json");
    saveAppStateAtomic(file, createEmptyAppState());
    fs.writeFileSync(`${file}.bak`, JSON.stringify(createEmptyAppState()), "utf8");
    const read = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    });
    try {
      expect(loadAppState(file)).toMatchObject({ ok: false, locked: true });
      expect(waits).toEqual([50, 100, 150, 200, 250]);
    } finally {
      read.mockRestore();
    }
  });

  it("repete o rename quando o Windows segura o destino por um instante", () => {
    const dir = tempDir("adr-state-rename-");
    const file = path.join(dir, "state.v1.json");
    const real = fs.renameSync;
    let fails = 2;
    const rename = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (fails-- > 0) throw Object.assign(new Error("perm"), { code: "EPERM" });
      return real(from, to);
    });
    try {
      saveAppStateAtomic(file, createEmptyAppState());
    } finally {
      rename.mockRestore();
    }
    expect(loadAppState(file)).toMatchObject({ ok: true, source: "primary" });
    expect(waits).toEqual([50, 100]);
  });
});

describe("withIoRetry", () => {
  const busy = (code: string) => Object.assign(new Error(code), { code });

  it("repete erro transitório e para no sucesso, sem dormir de verdade", () => {
    const sleeps: number[] = [];
    let calls = 0;
    const value = withIoRetry(
      () => {
        calls++;
        if (calls < 3) throw busy("EPERM");
        return "ok";
      },
      6,
      (ms) => sleeps.push(ms),
    );
    expect(value).toBe("ok");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([50, 100]);
  });

  it("erro que não passa sozinho (ENOENT) sobe na primeira tentativa", () => {
    let calls = 0;
    const fail = () => {
      calls++;
      throw busy("ENOENT");
    };
    expect(() => withIoRetry(fail, 6, () => undefined)).toThrow("ENOENT");
    expect(calls).toBe(1);
  });

  it("para no número de tentativas e só repete os códigos pedidos", () => {
    let calls = 0;
    const failWith = (code: string) => () => {
      calls++;
      throw busy(code);
    };
    expect(() => withIoRetry(failWith("EBUSY"), 3, () => undefined)).toThrow("EBUSY");
    expect(calls).toBe(3);
    calls = 0;
    expect(() => withIoRetry(failWith("EACCES"), 3, () => undefined, new Set(["EBUSY", "EPERM"]))).toThrow(
      "EACCES",
    );
    expect(calls).toBe(1);
  });
  it("valor de settings de uma versão mais nova cai no padrão em vez de quarentenar o estado", () => {
    const empty = createEmptyAppState();
    const parsed = parseAppState({
      ...empty,
      settings: { ...empty.settings, sidebarPosition: "floating", theme: "sepia", uiScale: 5 },
    });
    expect(parsed.settings.sidebarPosition).toBe("left");
    expect(parsed.settings.theme).toBe("system");
    expect(parsed.settings.uiScale).toBe(1);
  });
});
