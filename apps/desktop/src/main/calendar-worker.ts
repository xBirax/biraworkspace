import { parentPort, workerData } from "node:worker_threads";
import { upcomingMeetings } from "./calendar-reminders.js";

/**
 * Expansão da agenda fora do processo principal.
 *
 * Medido: 50 séries semanais desde 2016 custam ~1 s de CPU no ical.js, 200
 * séries ~8 s — no main thread isso congelava a janela inteira a cada 5 min.
 * Aqui roda numa worker thread descartável (uma por leitura).
 */
type Job = { ics: string; from: number; to: number; ownerEmail: string | null };

const job = workerData as Job;
try {
  parentPort?.postMessage({
    ok: true,
    meetings: upcomingMeetings(job.ics, job.from, job.to, { ownerEmail: job.ownerEmail }),
  });
} catch (error) {
  parentPort?.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) });
}
