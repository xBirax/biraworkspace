import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_CALENDAR_READ_MS,
  calendarExpander,
  STALE_REMINDER_MS,
  createCalendarScheduler,
  isGoogleHost,
  type CalendarResponse,
  type CalendarSchedulerDeps,
} from "./calendar-scheduler.js";
import { CALENDAR_REFRESH_MS, type UpcomingMeeting } from "./calendar-reminders.js";

const FEED = "https://calendar.google.com/calendar/ical/eu%40adr.com/private-abc123/basic.ics";
const T0 = Date.parse("2026-10-14T12:00:00Z");

const meeting = (minutesAhead: number, key = `m${minutesAhead}`): UpcomingMeeting => ({
  key,
  title: `Reunião ${key}`,
  startsAt: T0 + minutesAhead * 60_000,
  meetUrl: "https://meet.google.com/abc-defg-hij",
  organizer: "ana@adr.com",
});

const ok = (text = "BEGIN:VCALENDAR", url = FEED): CalendarResponse => ({
  ok: true,
  status: 200,
  url,
  text: async () => text,
});

function setup(overrides: Partial<CalendarSchedulerDeps> = {}) {
  const notify = vi.fn();
  const onChanged = vi.fn();
  const log = vi.fn();
  let feed: string | null = FEED;
  const deps: CalendarSchedulerDeps = {
    feedUrl: () => feed,
    feedBroken: () => false,
    fetch: vi.fn(async () => ok()),
    expand: vi.fn(async () => [meeting(30)]),
    reminderMinutes: () => 1,
    notificationsEnabled: () => true,
    notify,
    onChanged,
    log,
    ...overrides,
  };
  const scheduler = createCalendarScheduler(deps);
  return { scheduler, deps, notify, onChanged, log, setFeed: (value: string | null) => (feed = value) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createCalendarScheduler", () => {
  it("lê, mostra a próxima reunião, avisa as telas e lembra 1 min antes", async () => {
    const { scheduler, notify, onChanged } = setup();
    await expect(scheduler.refresh()).resolves.toEqual({ ok: true, message: "Agenda conectada", count: 1 });
    expect(scheduler.status()).toMatchObject({ ok: true, next: { title: "Reunião m30", startsAt: T0 + 30 * 60_000 } });
    expect(onChanged).toHaveBeenCalledOnce();
    expect(scheduler.pendingReminders()).toBe(1);
    await vi.advanceTimersByTimeAsync(29 * 60_000 - 1);
    expect(notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ key: "m30" }), 1);
    scheduler.dispose();
  });

  it("a primeira leitura sai sozinha depois de 15 s, e depois a cada 5 min", async () => {
    const { scheduler, deps } = setup();
    await vi.advanceTimersByTimeAsync(FIRST_CALENDAR_READ_MS);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CALENDAR_REFRESH_MS);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(CALENDAR_REFRESH_MS * 3);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
  });

  it("redirecionamento para fora do Google é recusado (o endereço é credencial)", async () => {
    const { scheduler, log } = setup({ fetch: async () => ok("x", "https://evil.example/basic.ics") });
    const result = await scheduler.refresh();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("redirecionou para fora do Google");
    // Nunca loga a URL do feed.
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-abc123");
    scheduler.dispose();
  });

  it("404 vira a explicação do endereço secreto", async () => {
    const { scheduler } = setup({ fetch: async () => ({ ok: false, status: 404, url: FEED, text: async () => "" }) });
    await scheduler.refresh();
    expect(scheduler.status()).toMatchObject({ ok: false });
    expect(scheduler.status()?.message).toContain("Endereço secreto");
    scheduler.dispose();
  });

  it("endereço salvo que não abre neste computador aparece como erro, não como 'conectada'", async () => {
    const { scheduler, setFeed } = setup({ feedBroken: () => true });
    setFeed(null);
    await expect(scheduler.refresh()).resolves.toMatchObject({ ok: false });
    expect(scheduler.status()?.message).toContain("não abre neste computador");
    scheduler.dispose();
  });

  it("sem endereço, status vazio e nenhum lembrete armado", async () => {
    const { scheduler, setFeed } = setup();
    await scheduler.refresh();
    expect(scheduler.pendingReminders()).toBe(1);
    setFeed(null);
    await scheduler.refresh();
    expect(scheduler.status()).toBeNull();
    expect(scheduler.pendingReminders()).toBe(0);
    scheduler.dispose();
  });

  it("leitura antiga que termina depois da nova não agenda nada", async () => {
    let releaseSlow!: (value: CalendarResponse) => void;
    const responses = [
      new Promise<CalendarResponse>((resolve) => (releaseSlow = resolve)),
      Promise.resolve(ok("NOVA")),
    ];
    const expand = vi.fn(async (ics: string) => (ics === "NOVA" ? [meeting(30, "nova")] : [meeting(20, "velha")]));
    const { scheduler } = setup({ fetch: () => responses.shift()!, expand });
    const slow = scheduler.refresh();
    await expect(scheduler.refresh()).resolves.toMatchObject({ ok: true });
    releaseSlow(ok("VELHA"));
    await expect(slow).resolves.toMatchObject({ message: "Leitura substituída por outra mais nova" });
    expect(scheduler.status()?.next?.title).toBe("Reunião nova");
    expect(expand).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it("lembrete atrasado (computador dormiu) para reunião que começou há mais de 5 min é descartado", async () => {
    const { scheduler, notify } = setup({ expand: async () => [meeting(2)] });
    await scheduler.refresh();
    // O timer do lembrete só dispara ao "acordar", bem depois do início.
    vi.setSystemTime(T0 + 2 * 60_000 + STALE_REMINDER_MS + 1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(notify).not.toHaveBeenCalled();
    scheduler.dispose();
  });

  it("mesma agenda dentro de 1 h reaproveita a expansão; agenda nova expande de novo", async () => {
    let text = "A";
    const expand = vi.fn(async () => [meeting(30)]);
    const { scheduler } = setup({ fetch: async () => ok(text), expand });
    await scheduler.refresh();
    await scheduler.refresh();
    expect(expand).toHaveBeenCalledTimes(1);
    text = "B";
    await scheduler.refresh();
    expect(expand).toHaveBeenCalledTimes(2);
    vi.setSystemTime(T0 + 61 * 60_000);
    await scheduler.refresh();
    expect(expand).toHaveBeenCalledTimes(3);
    scheduler.dispose();
  });

  it("reunião reaproveitada que já passou some do status", async () => {
    const { scheduler } = setup({ expand: async () => [meeting(10, "cedo"), meeting(50, "tarde")] });
    await scheduler.refresh();
    expect(scheduler.status()?.next?.title).toBe("Reunião cedo");
    vi.setSystemTime(T0 + 20 * 60_000);
    await scheduler.refresh();
    expect(scheduler.status()?.next?.title).toBe("Reunião tarde");
    scheduler.dispose();
  });

  it("com notificações desligadas não avisa, mas não repete depois", async () => {
    let enabled = false;
    const { scheduler, notify } = setup({ notificationsEnabled: () => enabled, expand: async () => [meeting(1)] });
    await scheduler.refresh();
    enabled = true;
    await scheduler.refresh();
    expect(notify).not.toHaveBeenCalled();
    scheduler.dispose();
  });
});

describe("isGoogleHost", () => {
  it("aceita google.com e subdomínios; recusa parecidos e lixo", () => {
    expect(isGoogleHost("https://calendar.google.com/x")).toBe(true);
    expect(isGoogleHost("https://google.com/")).toBe(true);
    expect(isGoogleHost("https://google.com.evil.example/")).toBe(false);
    expect(isGoogleHost("https://notgoogle.com/")).toBe(false);
    expect(isGoogleHost("não é url")).toBe(false);
  });
});

describe("calendarExpander sem worker (pnpm dev)", () => {
  it("expande no processo; iCal inválido vira erro legível no status", async () => {
    await expect(calendarExpander("")("lixo", 0, 1, null)).rejects.toThrow();
    vi.useRealTimers();
    const { scheduler } = setup({ fetch: async () => ok("lixo"), expand: calendarExpander("") });
    await scheduler.refresh();
    expect(scheduler.status()?.message).toContain("Não foi possível ler a agenda");
    scheduler.dispose();
  });
});
