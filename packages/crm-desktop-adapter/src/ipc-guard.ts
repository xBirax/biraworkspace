import { z } from "zod";
import type { CrmErrorCode } from "@adr/contracts";

const WHATSAPP_ORIGIN = "https://web.whatsapp.com";
const COMPOSER_KINDS = new Set([
  "gmail",
  "calendar",
  "drive",
  "notion",
  "youtube",
  "spotify",
  "browser",
  "instagram",
  // Outlook e Teams: e-mail e chat, o mesmo uso do Gmail.
  "outlook",
  "teams",
]);

export const composerTranslateRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(10_000),
    target: z.enum(["pt-BR", "en", "es"]),
  })
  .strict();

export type ComposerTranslateRequest = z.infer<typeof composerTranslateRequestSchema>;

export function viewKindAllowsComposerPreload(kind: string): boolean {
  return COMPOSER_KINDS.has(kind);
}

export function validateComposerTranslateRequest(
  payload: unknown,
  sender: { url?: string; frameIsMain?: boolean; kind?: string },
):
  | { ok: true; payload: ComposerTranslateRequest }
  | { ok: false; code: CrmErrorCode; message: string } {
  if (!viewKindAllowsComposerPreload(sender.kind || "")) {
    return { ok: false, code: "FORBIDDEN", message: "Tradutor indisponível nesta view." };
  }
  if (sender.frameIsMain === false) {
    return { ok: false, code: "FORBIDDEN", message: "Frame não autorizado." };
  }

  let url: URL;
  try {
    url = new URL(sender.url || "");
  } catch {
    return { ok: false, code: "FORBIDDEN", message: "Origem da solicitação inválida." };
  }
  if (!(["http:", "https:"] as string[]).includes(url.protocol)) {
    return { ok: false, code: "FORBIDDEN", message: "Origem da solicitação inválida." };
  }
  if (sender.kind === "gmail" && url.origin !== "https://mail.google.com") {
    return { ok: false, code: "FORBIDDEN", message: "Origem da solicitação inválida." };
  }
  if (sender.kind === "instagram" && url.origin !== "https://www.instagram.com") {
    return { ok: false, code: "FORBIDDEN", message: "Origem da solicitação inválida." };
  }

  const parsed = composerTranslateRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_REQUEST", message: "Solicitação de tradução inválida." };
  }
  return { ok: true, payload: parsed.data };
}

/** Commands used by the Chrome extension content script + desktop shell. */
export const desktopCrmCommandSchema = z.enum([
  "whoami",
  "lookup",
  "getChatIdentity",
  "translate",
  "transcribeMessage",
  "quickReplies",
  "getTranscriptCache",
  "cacheTranscript",
  "saveGoogleContact",
  "scheduleMeeting",
  "openCrm",
  "openSettings",
  "openOptions",
  "ping",
]);

export type DesktopCrmCommand = z.infer<typeof desktopCrmCommandSchema>;

/** Typed surface exposed by crm-preload — keep in sync with crm-preload.cjs. */
export const CRM_PRELOAD_METHODS = [
  "whoami",
  "lookup",
  "getChatIdentity",
  "translate",
  "transcribeMessage",
  "quickReplies",
  "getTranscriptCache",
  "cacheTranscript",
  "saveGoogleContact",
  "scheduleMeeting",
  "openCrm",
  "openSettings",
  "openOptions",
  "ping",
  "invoke",
] as const;

export type CrmPreloadMethod = (typeof CRM_PRELOAD_METHODS)[number];

export function viewKindAllowsCrmPreload(kind: string): boolean {
  return kind === "whatsapp";
}

export type IpcSenderInfo = {
  url?: string;
  frameIsMain?: boolean;
  isWhatsAppInstance?: boolean;
};

export type IpcValidationResult =
  | { ok: true; command: DesktopCrmCommand }
  | { ok: false; code: CrmErrorCode; message: string };

export function validateCrmIpcRequest(
  command: string,
  sender: IpcSenderInfo,
  _options: { packaged: boolean } = { packaged: true },
): IpcValidationResult {
  const normalized = command === "openOptions" ? "openSettings" : command;
  const parsed = desktopCrmCommandSchema.safeParse(normalized);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_REQUEST", message: "Comando CRM inválido." };
  }

  if (!sender.isWhatsAppInstance) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Preload CRM indisponível nesta view.",
    };
  }

  if (sender.frameIsMain === false) {
    return { ok: false, code: "FORBIDDEN", message: "Frame não autorizado." };
  }

  let origin = "";
  try {
    origin = sender.url ? new URL(sender.url).origin : "";
  } catch {
    origin = "";
  }

  if (origin !== WHATSAPP_ORIGIN) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Origem da solicitação inválida.",
    };
  }

  return { ok: true, command: parsed.data };
}
