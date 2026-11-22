import { describe, expect, it } from "vitest";
import { normalizeQuickRepliesPayload, planSafeQuickReplyInsert } from "../src/quick-replies.js";

describe("quick replies", () => {
  it("loads and dedupes templates for search/insert", () => {
    const data = normalizeQuickRepliesPayload({
      defaultTemplates: [{ id: "a", title: "Oi", body: "Olá!" }],
      templates: [
        { id: "a", title: "Oi override", body: "Olá override" },
        { id: "b", text: "Tudo bem?" },
        { id: "", body: "skip" },
      ],
    });
    expect(data.templates).toHaveLength(2);
    expect(data.templates.find((t) => t.id === "a")?.body).toBe("Olá override");
    expect(data.templates.find((t) => t.id === "b")?.text).toBe("Tudo bem?");
  });

  it("inserts text without auto-sending", () => {
    const plan = planSafeQuickReplyInsert("Mensagem pronta");
    expect(plan.clickSend).toBe(false);
    expect(plan.mechanism).toBe("clipboard-paste");
    expect(plan.forbiddenActions).toContain("click-send");
    expect(plan.text).toBe("Mensagem pronta");
  });
});
