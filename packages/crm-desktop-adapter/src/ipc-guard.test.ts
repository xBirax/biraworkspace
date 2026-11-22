import { describe, expect, it } from "vitest";
import {
  validateCrmIpcRequest,
  viewKindAllowsCrmPreload,
  CRM_PRELOAD_METHODS,
  desktopCrmCommandSchema,
  validateComposerTranslateRequest,
  viewKindAllowsComposerPreload,
} from "../src/index.js";

describe("CRM desktop IPC guard", () => {
  it("allows every command from a WhatsApp top frame", () => {
    for (const command of desktopCrmCommandSchema.options) {
      const result = validateCrmIpcRequest(command, {
        url: "https://web.whatsapp.com/",
        frameIsMain: true,
        isWhatsAppInstance: true,
      });
      expect(result.ok).toBe(true);
    }
  });

  it("maps openOptions to openSettings", () => {
    const result = validateCrmIpcRequest("openOptions", {
      url: "https://web.whatsapp.com/",
      frameIsMain: true,
      isWhatsAppInstance: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.command).toBe("openSettings");
  });

  it("blocks generic browser views", () => {
    const result = validateCrmIpcRequest("whoami", {
      url: "https://web.whatsapp.com/",
      frameIsMain: true,
      isWhatsAppInstance: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("blocks CRM login / shell senders even on lookalike WA URL", () => {
    for (const kind of ["crm", "shell", "browser"] as const) {
      expect(viewKindAllowsCrmPreload(kind)).toBe(false);
      const result = validateCrmIpcRequest("lookup", {
        url: "https://web.whatsapp.com/",
        frameIsMain: true,
        isWhatsAppInstance: viewKindAllowsCrmPreload(kind),
      });
      expect(result.ok).toBe(false);
    }
  });

  it("blocks lookalike origins", () => {
    const result = validateCrmIpcRequest("whoami", {
      url: "https://web.whatsapp.com.evil.example/",
      frameIsMain: true,
      isWhatsAppInstance: true,
    });
    expect(result.ok).toBe(false);
  });

  it("blocks iframes", () => {
    const result = validateCrmIpcRequest("lookup", {
      url: "https://web.whatsapp.com/",
      frameIsMain: false,
      isWhatsAppInstance: true,
    });
    expect(result.ok).toBe(false);
  });

  it("typed preload methods cover every IPC command plus invoke", () => {
    expect(viewKindAllowsCrmPreload("whatsapp")).toBe(true);
    for (const command of desktopCrmCommandSchema.options) {
      expect(CRM_PRELOAD_METHODS).toContain(command);
    }
    expect(CRM_PRELOAD_METHODS).toContain("invoke");
  });
});

describe("composer translation IPC guard", () => {
  it("allows supported top-level service pages", () => {
    expect(
      validateComposerTranslateRequest(
        { text: "Olá", target: "en" },
        { kind: "gmail", url: "https://mail.google.com/mail/u/0/#inbox", frameIsMain: true },
      ),
    ).toMatchObject({ ok: true, payload: { text: "Olá", target: "en" } });
    expect(
      validateComposerTranslateRequest(
        { text: "Hello", target: "es" },
        { kind: "instagram", url: "https://www.instagram.com/direct/", frameIsMain: true },
      ),
    ).toMatchObject({ ok: true });
    expect(viewKindAllowsComposerPreload("browser")).toBe(true);
  });

  it("rejects privileged views, lookalikes, iframes and invalid payloads", () => {
    const payload = { text: "Hello", target: "es" };
    for (const sender of [
      { kind: "whatsapp", url: "https://web.whatsapp.com/", frameIsMain: true },
      { kind: "gmail", url: "https://mail.google.com.evil.example/", frameIsMain: true },
      { kind: "instagram", url: "https://www.instagram.com.evil.example/", frameIsMain: true },
      { kind: "browser", url: "file:///tmp/test.html", frameIsMain: true },
      { kind: "browser", url: "https://example.com/", frameIsMain: false },
    ]) {
      expect(validateComposerTranslateRequest(payload, sender)).toMatchObject({ ok: false });
    }
    expect(
      validateComposerTranslateRequest(
        { text: "", target: "fr", workspaceId: "other" },
        { kind: "browser", url: "https://example.com/", frameIsMain: true },
      ),
    ).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });
});
