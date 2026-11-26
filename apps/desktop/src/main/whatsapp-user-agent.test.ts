import { describe, expect, it, vi } from "vitest";
import { configureSessionUserAgent, whatsappUserAgent } from "./whatsapp-user-agent.js";

describe("WhatsApp compatibility identity", () => {
  it.each([
    "Windows NT 10.0; Win64; x64",
    "X11; Linux x86_64",
    "Macintosh; Intel Mac OS X 10_15_7",
  ])("preserves actual Chromium and platform: %s", (platform) => {
    const base = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko)`;
    expect(
      whatsappUserAgent(
        `${base} ADRWorkspace/0.1.40 Chrome/152.0.7977.65 Electron/44.1.0 Safari/537.36`,
      ),
    ).toBe(`${base} Chrome/152.0.7977.65 Safari/537.36`);
  });

  it("is idempotent for reused sessions", () => {
    const ua = "Mozilla/5.0 Chrome/152.0.7977.65 Safari/537.36";
    expect(whatsappUserAgent(ua)).toBe(ua);
  });

  it("removes the packaged Bira identity while preserving the real Chromium version", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) BiraWorkspace/0.2.0-local.1 Chrome/152.0.7977.65 Electron/44.1.0 Safari/537.36";
    expect(whatsappUserAgent(ua)).toBe("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.65 Safari/537.36");
  });

  it("sets the WhatsApp session and returns the same identity for its view", () => {
    const ses = {
      getUserAgent: vi.fn(() => "Chrome/152.0.7977.65 Electron/44.1.0"),
      setUserAgent: vi.fn(),
    };
    expect(configureSessionUserAgent("whatsapp", ses)).toBe("Chrome/152.0.7977.65");
    expect(ses.setUserAgent).toHaveBeenCalledWith("Chrome/152.0.7977.65");
  });

  it.each(["gmail", "calendar", "youtube", "browser", "spotify", "instagram"] as const)(
    "does not access or modify the %s session",
    (kind) => {
      const ses = { getUserAgent: vi.fn(), setUserAgent: vi.fn() };
      expect(configureSessionUserAgent(kind, ses)).toBeUndefined();
      expect(ses.getUserAgent).not.toHaveBeenCalled();
      expect(ses.setUserAgent).not.toHaveBeenCalled();
    },
  );
});
