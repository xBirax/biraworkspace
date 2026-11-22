import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeetCallTracker, formatMeetingDuration } from "./meet-calls.js";
import { MEET_TOGGLE_MIC } from "./meet.js";
import { contactMatchesFrom, logMeetingToCrm, meetingActivityPayload } from "./crm-meeting-log.js";
import { calendarEventTemplateUrl, meetingFromChat } from "./schedule-meeting.js";
import {
  acknowledgeBackupStatus,
  backupNoticeToShow,
  backupInProgress,
  backupsDirectory,
  legacyBackupsDirectory,
  listProfileBackups,
  readBackupStatus,
} from "./profile-backup.js";

describe("MeetCallTracker", () => {
  it("avisa início e fim, uma vez cada, com a duração", () => {
    const started: string[] = [];
    const ended: number[] = [];
    const tracker = new MeetCallTracker({
      onStart: (call) => started.push(call.room),
      onEnd: (call) => ended.push(call.endedAt - call.startedAt),
    });
    tracker.update("meet-1", "abc-defg-hij", true, 1000);
    tracker.update("meet-1", "abc-defg-hij", true, 2000); // sonda repetida
    expect(tracker.active).toBe(true);
    tracker.update("meet-1", "abc-defg-hij", false, 61_000);
    tracker.update("meet-1", "abc-defg-hij", false, 62_000);
    expect(started).toEqual(["abc-defg-hij"]);
    expect(ended).toEqual([60_000]);
    expect(tracker.active).toBe(false);
  });

  it("trocar de sala direto são duas reuniões; aba que some encerra a chamada", () => {
    const events: string[] = [];
    const tracker = new MeetCallTracker({
      onStart: (call) => events.push(`+${call.room}`),
      onEnd: (call) => events.push(`-${call.room}`),
    });
    tracker.update("meet-1", "aaa-aaaa-aaa", true, 0);
    tracker.update("meet-1", "bbb-bbbb-bbb", true, 10);
    tracker.forget("meet-1", 20);
    tracker.forget("meet-1", 30);
    expect(events).toEqual(["+aaa-aaaa-aaa", "-aaa-aaaa-aaa", "+bbb-bbbb-bbb", "-bbb-bbbb-bbb"]);
  });

  it("formata a duração para o registro", () => {
    expect(formatMeetingDuration(20_000)).toBe("1 min");
    expect(formatMeetingDuration(45 * 60_000)).toBe("45 min");
    expect(formatMeetingDuration(65 * 60_000)).toBe("1 h 05 min");
    expect(formatMeetingDuration(120 * 60_000)).toBe("2 h");
  });
});

describe("MEET_TOGGLE_MIC", () => {
  const run = (labels: string[]) => {
    const clicked: string[] = [];
    const nodes = labels.map((label) => ({ getAttribute: () => label, click: () => clicked.push(label) }));
    const result = new Function("document", `return ${MEET_TOGGLE_MIC}`)({
      querySelectorAll: () => nodes,
    }) as string;
    return { result, clicked };
  };

  it("desliga quando o botão oferece desativar, e liga quando oferece ativar", () => {
    expect(run(["Desativar microfone (ctrl + d)", "Sair da chamada"])).toEqual({
      result: "muted",
      clicked: ["Desativar microfone (ctrl + d)"],
    });
    // "desativar" contém "ativar": o botão de ligar não pode ser confundido.
    expect(run(["Ativar microfone (ctrl + d)"])).toEqual({
      result: "unmuted",
      clicked: ["Ativar microfone (ctrl + d)"],
    });
    expect(run(["Turn off microphone"]).result).toBe("muted");
    expect(run(["Câmera"])).toEqual({ result: "", clicked: [] });
  });
});

describe("registro da reunião no CRM", () => {
  const contact = { id: "c1", name: "Ana Silva", companyId: "co1", companyName: "ACME", companyIds: ["co1"] };

  it("lê contatos da busca do CRM, com ou sem empresa", () => {
    expect(
      contactMatchesFrom({
        items: [
          { id: "c1", name: " Ana Silva ", company: { id: "co1", name: "ACME" } },
          { id: "c2", name: "", companyId: "co2" },
          { id: "c3", name: "Sem Empresa", company: null },
          { name: "sem id" },
          "lixo",
        ],
      }),
    ).toEqual([
      { id: "c1", name: "Ana Silva", companyId: "co1", companyName: "ACME", companyIds: ["co1"] },
      { id: "c2", name: "(sem nome)", companyId: "co2", companyName: null, companyIds: ["co2"] },
      { id: "c3", name: "Sem Empresa", companyId: null, companyName: null, companyIds: [] },
    ]);
    expect(contactMatchesFrom(null)).toEqual([]);
  });

  it("monta a atividade de reunião no formato do CRM", () => {
    expect(
      meetingActivityPayload({
        contact,
        room: "abc-defg-hij",
        startedAt: Date.parse("2026-10-14T13:00:00Z"),
        durationLabel: "45 min",
      }),
    ).toEqual({
      type: "meeting",
      title: "Reunião com Ana Silva",
      notes: "Reunião pelo Google Meet (https://meet.google.com/abc-defg-hij).\nDuração: 45 min.",
      dueAt: "2026-10-14T13:00:00.000Z",
      contactId: "c1",
      companyId: "co1",
    });
  });

  it("cria a atividade e a marca como feita", async () => {
    const calls: Array<[string, string | undefined]> = [];
    const callCrm = vi.fn(async (apiPath: string, init?: RequestInit) => {
      calls.push([apiPath, init?.method]);
      return apiPath === "/api/crm/activities" ? { item: { id: "act-9" } } : { item: {} };
    });
    await expect(
      logMeetingToCrm(callCrm, { contact, room: "abc-defg-hij", startedAt: 0, durationLabel: "5 min" }),
    ).resolves.toEqual({ id: "act-9" });
    expect(calls).toEqual([
      ["/api/crm/activities", "POST"],
      ["/api/crm/activities/act-9", "PATCH"],
    ]);
  });

  it("recusa contato sem empresa antes de chamar o CRM", async () => {
    const callCrm = vi.fn();
    await expect(
      logMeetingToCrm(callCrm, {
        contact: { ...contact, companyId: null },
        room: "abc-defg-hij",
        startedAt: 0,
        durationLabel: "5 min",
      }),
    ).rejects.toThrow(/empresa/);
    expect(callCrm).not.toHaveBeenCalled();
  });
});

describe("Agendar reunião", () => {
  it("monta o evento do Calendar com sala do Meet e convidado válido", () => {
    const { title, details } = meetingFromChat({ name: "Ana Silva", phone: "+5511999990000" });
    const url = new URL(
      calendarEventTemplateUrl({ title, details, guestEmail: "ana@acme.com", authuser: "eu@adr.com" }),
    );
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Reunião com Ana Silva");
    expect(url.searchParams.get("details")).toContain("+5511999990000");
    expect(url.searchParams.get("add")).toBe("ana@acme.com");
    expect(url.searchParams.get("vcon")).toBe("meet");
    expect(url.searchParams.get("authuser")).toBe("eu@adr.com");
  });

  it("ignora convidado inválido e conversa sem nome", () => {
    const { title } = meetingFromChat({ phone: "+5511" });
    const url = new URL(calendarEventTemplateUrl({ title, guestEmail: "não é e-mail" }));
    expect(url.searchParams.get("text")).toBe("Reunião com +5511");
    expect(url.searchParams.has("add")).toBe(false);
  });
});

describe("lista de backups do perfil", () => {
  // Removidas mesmo quando o teste falha no meio.
  const temps: string[] = [];
  const tempDir = (prefix: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    temps.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lista só cópias completas, das duas pastas, mais nova primeiro", () => {
    const base = tempDir("adr-backup-");
    const userData = path.join(base, "ADR Workspace");
    // Pasta nova (LOCALAPPDATA) e a antiga, ao lado do perfil.
    const root = backupsDirectory(userData, path.join(base, "Local"));
    const legacy = legacyBackupsDirectory(userData);
    expect(root).toBe(path.join(base, "Local", "ADR Workspace Backups"));
    expect(backupsDirectory(userData, "")).toBe(legacy);
    fs.mkdirSync(path.join(legacy, "antes-0.1.49-20261001"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "antes-0.1.49-20261001", "backup-info.json"), "{}");
    fs.utimesSync(path.join(legacy, "antes-0.1.49-20261001", "backup-info.json"), 1_600_000_000, 1_600_000_000);
    const make = (name: string, complete: boolean, mtime: number) => {
      fs.mkdirSync(path.join(root, name), { recursive: true });
      if (!complete) return;
      const info = path.join(root, name, "backup-info.json");
      fs.writeFileSync(info, "{}");
      fs.utimesSync(info, mtime, mtime);
    };
    make("auto-0.1.50-20261001-100000", true, 1_700_000_000);
    make("manual-20261010-100000", true, 1_800_000_000);
    make("auto-interrompida", false, 0);
    expect(listProfileBackups([root, legacy]).map((b) => [b.name, b.kind])).toEqual([
      ["manual-20261010-100000", "manual"],
      ["auto-0.1.50-20261001-100000", "auto"],
      ["antes-0.1.49-20261001", "outro"],
    ]);
    expect(listProfileBackups([path.join(root, "nao-existe")])).toEqual([]);
  });

  it("lê o status do script (com BOM), detecta cópia em andamento e falha a mostrar", () => {
    const root = tempDir("adr-backup-status-");
    const now = Date.parse("2026-10-14T12:00:00Z");
    const write = (data: object) =>
      fs.writeFileSync(path.join(root, "backup-status.json"), "﻿" + JSON.stringify(data));
    write({ state: "running", startedAt: "2026-10-14T11:50:00Z" });
    expect(backupInProgress(readBackupStatus(root), now)).toBe(true);
    // Começou há mais de 30 min sem terminar: script morto, não segura o app.
    write({ state: "running", startedAt: "2026-10-14T10:00:00Z" });
    expect(backupInProgress(readBackupStatus(root), now)).toBe(false);
    write({ state: "failed", finishedAt: "2026-10-14T11:00:00Z", message: "robocopy 16" });
    const status = readBackupStatus(root);
    expect(backupNoticeToShow(status, now)).toBe("Backup do perfil: robocopy 16");
    acknowledgeBackupStatus(root, status!);
    expect(backupNoticeToShow(readBackupStatus(root), now)).toBeNull();
    expect(readBackupStatus(path.join(root, "nao-existe"))).toBeNull();
  });
});

describe("MEET_TOGGLE_MIC escolhe o botão da barra", () => {
  it("prefere o próprio microfone ao de outro participante no painel de pessoas", () => {
    const clicked: string[] = [];
    const nodes = ["Desativar microfone de Ana", "Desativar microfone (ctrl + d)"].map((label) => ({
      getAttribute: () => label,
      click: () => clicked.push(label),
    }));
    const result = new Function("document", `return ${MEET_TOGGLE_MIC}`)({ querySelectorAll: () => nodes });
    expect(result).toBe("muted");
    expect(clicked).toEqual(["Desativar microfone (ctrl + d)"]);
  });
});

describe("contato com a empresa só no segundo vínculo", () => {
  it("usa a company2 para registrar a reunião", () => {
    expect(
      contactMatchesFrom({ items: [{ id: "c9", name: "Bia", company: null, company2: { id: "co2", name: "Beta" } }] }),
    ).toEqual([{ id: "c9", name: "Bia", companyId: "co2", companyName: "Beta", companyIds: ["co2"] }]);
  });
});
