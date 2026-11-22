import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import {
  CALENDAR_REFRESH_MS,
  calendarErrorMessage,
  calendarOwnerFromIcsUrl,
  isGoogleCalendarIcsUrl,
  upcomingMeetings,
  type UpcomingMeeting,
} from "./calendar-reminders.js";
import { planReminders } from "./meet-calls.js";

/**
 * Lembrete de reunião: lê a agenda (endereço iCal secreto do Google Calendar) a
 * cada 5 min, agenda os avisos e guarda o status que o painel mostra.
 *
 * Saiu de meet-integration.ts sem nada de Electron: a rede, a expansão da
 * agenda e o aviso chegam em `deps` — e por isso dá para testar com relógio
 * falso.
 */

/** Lembrete atrasado (o computador dormiu) para reunião que já começou há tanto: descarta. */
export const STALE_REMINDER_MS = 5 * 60_000;
/** Teto da leitura da agenda na worker thread. */
const CALENDAR_WORKER_TIMEOUT_MS = 30_000;
/** Teto do download da agenda. */
const CALENDAR_FETCH_TIMEOUT_MS = 20_000;
/** Primeira leitura depois de abrir: os serviços já de pé. */
export const FIRST_CALENDAR_READ_MS = 15_000;
/**
 * Até onde olhar a agenda a cada leitura: 24 h, para o painel mostrar a
 * próxima reunião. Os lembretes de qualquer ponto dessa janela ficam agendados
 * (e são refeitos a cada leitura).
 */
export const CALENDAR_LOOKAHEAD_MS = 24 * 60 * 60_000;
/**
 * A agenda quase nunca muda entre duas leituras: com o mesmo texto, reaproveita
 * a expansão (que olha 1 h além das 24 h) por até 1 h, em vez de subir uma
 * worker e reler tudo a cada 5 min.
 */
const EXPANSION_REUSE_MS = 60 * 60_000;

export type CalendarStatus = {
  ok: boolean;
  message: string;
  checkedAt: number;
  next?: { title: string; startsAt: number } | null;
};

export type CalendarReadResult = { ok: boolean; message: string; count: number };

export type CalendarExpander = (
  ics: string,
  from: number,
  to: number,
  ownerEmail: string | null,
) => Promise<UpcomingMeeting[]>;

/** O pedaço da resposta HTTP que a leitura usa (net.fetch devolve um Response). */
export type CalendarResponse = { ok: boolean; status: number; url: string; text: () => Promise<string> };

export type CalendarSchedulerDeps = {
  /** Endereço iCal decifrado, ou null. */
  feedUrl: () => string | null;
  /** Há endereço salvo, mas ele não abre neste computador/usuário (safeStorage). */
  feedBroken: () => boolean;
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<CalendarResponse>;
  expand: CalendarExpander;
  reminderMinutes: () => number;
  notificationsEnabled: () => boolean;
  /** Mostra o aviso da reunião (minutos até começar; 0 = começando). */
  notify: (meeting: UpcomingMeeting, minutes: number) => void;
  /** O status mudou: atualizar as telas. */
  onChanged: () => void;
  log: (level: "info" | "error", message: string, extra?: unknown) => void;
  now?: () => number;
};

/**
 * Expande a agenda numa worker thread (medido: agendas grandes custavam
 * segundos de CPU, que no main thread congelavam a janela). Sem o arquivo do
 * worker (pnpm dev sem build do worker), expande aqui mesmo.
 */
export function calendarExpander(workerPath: string): CalendarExpander {
  if (!workerPath) return async (ics, from, to, ownerEmail) => upcomingMeetings(ics, from, to, { ownerEmail });
  return (ics, from, to, ownerEmail) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { workerData: { ics, from, to, ownerEmail } });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error("a leitura da agenda demorou demais"));
      }, CALENDAR_WORKER_TIMEOUT_MS);
      worker.once("message", (reply: { ok: boolean; meetings?: UpcomingMeeting[]; message?: string }) => {
        clearTimeout(timer);
        void worker.terminate();
        if (reply.ok) resolve(reply.meetings ?? []);
        else reject(new Error(reply.message || "agenda ilegível"));
      });
      worker.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
}

/** Redirecionamento só dentro do Google: o endereço é credencial e a resposta vira lembrete clicável. */
export function isGoogleHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "google.com" || host.endsWith(".google.com");
  } catch {
    return false;
  }
}

export function createCalendarScheduler(deps: CalendarSchedulerDeps) {
  const now = deps.now ?? Date.now;
  const reminded = new Map<string, number>();
  const reminderTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let status: CalendarStatus | null = null;
  let disposed = false;
  /** Só a leitura mais recente vale: a antiga que termina depois não agenda nada. */
  let generation = 0;
  let expansion: { hash: string; owner: string | null; at: number; meetings: UpcomingMeeting[] } | null = null;

  function remind(meeting: UpcomingMeeting): void {
    reminded.set(meeting.key, meeting.startsAt);
    if (!deps.notificationsEnabled()) return;
    // Timer que disparou ao acordar o computador: a reunião já passou.
    if (now() > meeting.startsAt + STALE_REMINDER_MS) return;
    const minutes = Math.max(0, Math.round((meeting.startsAt - now()) / 60_000));
    deps.notify(meeting, minutes);
    deps.log("info", "lembrete de reunião", { minutos: minutes });
  }

  function schedule(meetings: UpcomingMeeting[], at: number): void {
    for (const timer of reminderTimers.values()) clearTimeout(timer);
    reminderTimers.clear();
    if (disposed) return;
    const byKey = new Map(meetings.map((meeting) => [meeting.key, meeting]));
    const plan = planReminders(meetings, reminded, at, deps.reminderMinutes() * 60_000);
    for (const key of plan.now) remind(byKey.get(key)!);
    for (const [key, delay] of plan.later) {
      reminderTimers.set(key, setTimeout(() => remind(byKey.get(key)!), delay));
    }
  }

  async function meetingsOf(ics: string, owner: string | null, at: number): Promise<UpcomingMeeting[]> {
    const from = at - 60_000;
    const to = at + CALENDAR_LOOKAHEAD_MS;
    const hash = createHash("sha256").update(ics).digest("hex");
    if (!expansion || expansion.hash !== hash || expansion.owner !== owner || at - expansion.at > EXPANSION_REUSE_MS) {
      expansion = { hash, owner, at, meetings: await deps.expand(ics, from, to + EXPANSION_REUSE_MS, owner) };
    }
    return expansion.meetings.filter((meeting) => meeting.startsAt >= from && meeting.startsAt <= to);
  }

  async function read(): Promise<CalendarReadResult> {
    if (disposed) return { ok: false, message: "Janela fechada", count: 0 };
    const mine = ++generation;
    const url = deps.feedUrl();
    if (!url) {
      schedule([], now());
      expansion = null;
      if (deps.feedBroken()) {
        // Perfil restaurado em outro computador/usuário: o cofre do Windows não
        // abre o endereço salvo. Sem isto o painel dizia "Agenda conectada".
        const message = "O endereço salvo não abre neste computador. Cole o endereço iCal de novo.";
        status = { ok: false, message, checkedAt: now() };
        return { ok: false, message, count: 0 };
      }
      status = null;
      return { ok: false, message: "Agenda não configurada", count: 0 };
    }
    if (!isGoogleCalendarIcsUrl(url)) {
      schedule([], now());
      return { ok: false, message: "Endereço inválido", count: 0 };
    }
    const stale = (): boolean => disposed || mine !== generation || deps.feedUrl() !== url;
    const replaced = { ok: false, message: "Leitura substituída por outra mais nova", count: 0 };
    try {
      const response = await deps.fetch(url, { signal: AbortSignal.timeout(CALENDAR_FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`http:${response.status}`);
      if (!isGoogleHost(response.url || url)) throw new Error("a agenda redirecionou para fora do Google");
      const ics = await response.text();
      if (stale()) return replaced;
      const at = now();
      const meetings = await meetingsOf(ics, calendarOwnerFromIcsUrl(url), at);
      if (stale()) return replaced;
      // now(), não `at`: a leitura no worker leva até 30 s e o atraso de cada
      // lembrete contado do instante antigo o fazia sair atrasado.
      schedule(meetings, now());
      const next = meetings.find((meeting) => meeting.startsAt > at);
      status = {
        ok: true,
        message: "Agenda conectada",
        checkedAt: at,
        next: next ? { title: next.title, startsAt: next.startsAt } : null,
      };
      return { ok: true, message: "Agenda conectada", count: meetings.length };
    } catch (error) {
      if (stale()) return replaced;
      // Nunca logar a URL: ela é a credencial de leitura da agenda.
      const message = calendarErrorMessage(error);
      status = { ok: false, message, checkedAt: now() };
      deps.log("error", "agenda do lembrete", { erro: message.slice(0, 120) });
      return { ok: false, message, count: 0 };
    }
  }

  /** Lê a agenda e avisa as telas: o painel mostra o status e a próxima reunião. */
  async function refresh(): Promise<CalendarReadResult> {
    const result = await read();
    if (!disposed) deps.onChanged();
    return result;
  }

  const refreshTimer = setInterval(() => void refresh(), CALENDAR_REFRESH_MS);
  const firstRead = setTimeout(() => void refresh(), FIRST_CALENDAR_READ_MS);

  function dispose(): void {
    disposed = true;
    clearInterval(refreshTimer);
    clearTimeout(firstRead);
    for (const timer of reminderTimers.values()) clearTimeout(timer);
    reminderTimers.clear();
  }

  return {
    refresh,
    status: (): CalendarStatus | null => status,
    /** Lembretes armados agora (para diagnóstico e testes). */
    pendingReminders: (): number => reminderTimers.size,
    dispose,
  };
}

export type CalendarScheduler = ReturnType<typeof createCalendarScheduler>;
