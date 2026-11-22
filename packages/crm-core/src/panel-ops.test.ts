import { describe, expect, it } from "vitest";
import {
  applyCrmPanelKillSwitch,
  beginTranslate,
  cancelTranslate,
  completeTranslate,
  failTranslate,
  normalizeTranscribeResult,
  readCachedTranscript,
  shouldMountCrmPanel,
  writeCachedTranscript,
} from "../src/panel-ops.js";

describe("translate / transcribe / cache / kill switch", () => {
  it("preserves original text and stays recoverable/cancelable", () => {
    const original = "Hello world";
    const loading = beginTranslate(original);
    expect(loading).toMatchObject({ status: "loading", original, abortable: true });
    expect(completeTranslate(original, { translatedText: "Olá mundo", sourceLanguage: "en" })).toEqual({
      status: "done",
      original,
      translatedText: "Olá mundo",
      sourceLanguage: "en",
    });
    expect(failTranslate(original, "rede")).toMatchObject({
      status: "error",
      original,
      recoverable: true,
    });
    expect(cancelTranslate(original)).toEqual({ status: "idle", original });
  });

  it("handles audio success, invalid file/network and retry", () => {
    expect(
      normalizeTranscribeResult({ status: "completed", text: "áudio ok", error: null }),
    ).toEqual({ status: "done", text: "áudio ok" });
    // Pendente é "loading", não erro: o content script faz poll nesse estado.
    expect(normalizeTranscribeResult({ status: "processing", text: null, error: null })).toEqual({
      status: "loading",
    });
    expect(normalizeTranscribeResult({ status: "pending", text: null, error: null })).toEqual({
      status: "loading",
    });
    expect(normalizeTranscribeResult({ status: "failed", text: null, error: "arquivo inválido" })).toMatchObject({
      status: "error",
      retryable: true,
    });
    const invalid = normalizeTranscribeResult("nope");
    expect(invalid.status).toBe("error");
    if (invalid.status === "error") expect(invalid.retryable).toBe(true);
  });

  it("reuses transcript cache without a new transcription", () => {
    const cache = writeCachedTranscript({}, "msg-1", "texto cacheado", 1_000);
    expect(readCachedTranscript(cache, "msg-1", 1_000)).toBe("texto cacheado");
    expect(readCachedTranscript(cache, "msg-2", 1_000)).toBeNull();
  });

  it("kill switch disables panel while WhatsApp stays usable", () => {
    const on = applyCrmPanelKillSwitch({ enabled: true }, true);
    expect(shouldMountCrmPanel(on, false)).toBe(true);
    const off = applyCrmPanelKillSwitch(on, false, "DOM quebrado");
    expect(off.enabled).toBe(false);
    expect(shouldMountCrmPanel(off, false)).toBe(false);
    expect(shouldMountCrmPanel(on, true)).toBe(false);
  });
});
