import { translateDataSchema, transcribeDataSchema } from "@adr/contracts";
import { normalizeTranscriptCache, upsertTranscriptCache } from "./transcript-cache.js";

export type TranslateState =
  | { status: "idle"; original: string }
  | { status: "loading"; original: string; abortable: true }
  | { status: "done"; original: string; translatedText: string; sourceLanguage?: string }
  | { status: "error"; original: string; message: string; recoverable: true };

export function beginTranslate(original: string): TranslateState {
  return { status: "loading", original: String(original || ""), abortable: true };
}

export function completeTranslate(
  original: string,
  raw: unknown,
): TranslateState {
  const parsed = translateDataSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.translatedText) {
    return {
      status: "error",
      original,
      message: "Tradução indisponível",
      recoverable: true,
    };
  }
  const next: TranslateState = {
    status: "done",
    original,
    translatedText: parsed.data.translatedText,
  };
  if (parsed.data.sourceLanguage) next.sourceLanguage = parsed.data.sourceLanguage;
  return next;
}

export function failTranslate(original: string, message: string): TranslateState {
  return {
    status: "error",
    original,
    message: String(message || "erro"),
    recoverable: true,
  };
}

export function cancelTranslate(original: string): TranslateState {
  return { status: "idle", original };
}

export type TranscribeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; text: string }
  | { status: "error"; message: string; retryable: true };

export function normalizeTranscribeResult(raw: unknown): TranscribeState {
  const parsed = transcribeDataSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: "resposta de transcrição inválida", retryable: true };
  }
  if (parsed.data.status === "completed" && parsed.data.text) {
    return { status: "done", text: parsed.data.text };
  }
  // "loading", não "error": o content script tem um poll progressivo para o
  // estado pendente (1,5s → 8s). Devolver erro aqui matava esse poll — o áudio
  // ainda em processamento no CRM virava falha definitiva no primeiro retorno.
  if (parsed.data.status === "processing" || parsed.data.status === "pending") {
    return { status: "loading" };
  }
  return {
    status: "error",
    message: parsed.data.error || "transcrição indisponível",
    retryable: true,
  };
}

export function readCachedTranscript(
  cache: unknown,
  externalId: string,
  now = Date.now(),
): string | null {
  const normalized = normalizeTranscriptCache(cache, now);
  const hit = normalized[String(externalId || "").trim()];
  return hit?.text || null;
}

export function writeCachedTranscript(
  cache: unknown,
  externalId: string,
  text: string,
  now = Date.now(),
) {
  return upsertTranscriptCache(cache, externalId, text, now);
}

/** Local kill switch — disable CRM panel without touching WhatsApp Web. */
export type CrmPanelKillSwitch = {
  enabled: boolean;
  reason?: string;
};

export function applyCrmPanelKillSwitch(
  current: CrmPanelKillSwitch,
  enabled: boolean,
  reason?: string,
): CrmPanelKillSwitch {
  if (enabled) return { enabled: true };
  const next: CrmPanelKillSwitch = { enabled: false };
  if (reason) next.reason = reason;
  return { ...current, ...next, enabled: false };
}

export function shouldMountCrmPanel(killSwitch: CrmPanelKillSwitch, domBroken: boolean): boolean {
  if (!killSwitch.enabled) return false;
  if (domBroken) return false;
  return true;
}
