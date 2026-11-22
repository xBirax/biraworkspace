import { describe, expect, it } from "vitest";
import {
  CRM_COMMANDS,
  crmResultSchema,
  extensionMessageTypeSchema,
  isCrmCommand,
  lookupDataSchema,
  mapExtensionErrorCode,
  whoamiDataSchema,
  serviceInstanceSchema,
} from "../src/index.js";
import { z } from "zod";

describe("contracts from extension 0.12.5", () => {
  it("prazo de hibernação é opcional e tolera valores futuros ou inválidos", () => {
    const service = { id: "s", workspaceId: "w", kind: "notion", name: "Notas", startUrl: "https://notion.so", profileId: "p", pinned: false, keepAwake: false };
    expect(serviceInstanceSchema.parse(service).hibernateAfterMinutes).toBeUndefined();
    expect(serviceInstanceSchema.parse({ ...service, hibernateAfterMinutes: 30 }).hibernateAfterMinutes).toBe(30);
    for (const minutes of [0, -1, 1.5, 1441, "dez"]) {
      expect(serviceInstanceSchema.parse({ ...service, hibernateAfterMinutes: minutes }).hibernateAfterMinutes).toBeUndefined();
    }
  });
  it("lists plan CRM commands", () => {
    expect(CRM_COMMANDS).toEqual([
      "whoami",
      "lookup",
      "getChatIdentity",
      "translate",
      "transcribeMessage",
      "quickReplies",
      "getTranscriptCache",
      "cacheTranscript",
      "openCrm",
      "openSettings",
    ]);
    expect(isCrmCommand("whoami")).toBe(true);
    expect(isCrmCommand("ping")).toBe(false);
  });

  it("accepts extension runtime message types including ping/openOptions", () => {
    expect(extensionMessageTypeSchema.parse("ping")).toBe("ping");
    expect(extensionMessageTypeSchema.parse("openOptions")).toBe("openOptions");
  });

  it("parses whoami fixture", () => {
    const parsed = whoamiDataSchema.parse({ hasCrm: true, scope: "tenant:user" });
    expect(parsed.hasCrm).toBe(true);
  });

  it("parses lookup fixture shaped like background.js", () => {
    const parsed = lookupDataSchema.parse({
      deals: [{ id: "d1", number: "1", title: "Deal", status: "OPEN" }],
      contacts: [{ id: "c1", name: "Ana", phone: "5511999999999", company: null }],
      projects: [{ id: "p1", title: "Proj", status: "active" }],
      warnings: [],
    });
    expect(parsed.contacts).toHaveLength(1);
  });

  it("wraps ok/error results", () => {
    const schema = crmResultSchema(z.object({ hasCrm: z.boolean() }));
    expect(schema.parse({ ok: true, data: { hasCrm: true } }).ok).toBe(true);
    expect(
      schema.parse({ ok: false, code: "UNAUTHENTICATED", message: "login" }).ok,
    ).toBe(false);
  });

  it("maps extension error codes without behavior change", () => {
    expect(mapExtensionErrorCode("NOT_CONFIGURED")).toBe("UNAUTHENTICATED");
    expect(mapExtensionErrorCode("IMPERSONATION_UNSUPPORTED")).toBe("UNSUPPORTED");
    expect(mapExtensionErrorCode("TIMEOUT")).toBe("NETWORK");
    expect(mapExtensionErrorCode(undefined, 429)).toBe("RATE_LIMITED");
  });
});
