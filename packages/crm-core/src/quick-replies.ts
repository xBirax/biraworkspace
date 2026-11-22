import { quickRepliesDataSchema, quickReplyTemplateSchema, type QuickRepliesData } from "@adr/contracts";

function templateBody(raw: Record<string, unknown>): string {
  return String(raw["body"] || raw["text"] || "").trim();
}

/** Merge default + user templates like extension 0.12.5 background.quickReplies. */
export function normalizeQuickRepliesPayload(raw: unknown): QuickRepliesData {
  const root =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const byId = new Map<string, unknown>();
  const lists = [root["defaultTemplates"], root["templates"], root["items"]];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const id = String(row["id"] || "").trim();
      if (!id) continue;
      byId.set(id, {
        id,
        title: row["title"] == null ? undefined : String(row["title"]),
        body: templateBody(row) || undefined,
        text: row["text"] == null ? undefined : String(row["text"]),
      });
    }
  }
  const templates = [];
  for (const value of byId.values()) {
    const parsed = quickReplyTemplateSchema.safeParse(value);
    if (parsed.success) templates.push(parsed.data);
  }
  return quickRepliesDataSchema.parse({ templates });
}

export type SafeComposerInsert = {
  mechanism: "clipboard-paste";
  text: string;
  /** Gate R26: never auto-send after insert. */
  clickSend: false;
  forbiddenActions: readonly ["click-send", "keydown-enter-send"];
};

/** Insert plan for quick replies — paste into composer only, never send. */
export function planSafeQuickReplyInsert(body: string): SafeComposerInsert {
  const text = String(body || "");
  return {
    mechanism: "clipboard-paste",
    text,
    clickSend: false,
    forbiddenActions: ["click-send", "keydown-enter-send"],
  };
}
