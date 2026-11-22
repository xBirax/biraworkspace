import { describe, expect, it } from "vitest";
import { chromeShim } from "./extension-inject.js";

/** Roda o shim contra um localStorage de mentira, como o da página do WhatsApp. */
function load(stored: string | null) {
  const data = new Map<string, string>();
  if (stored !== null) data.set("adrCrmStorage", stored);
  const localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  };
  const win: Record<string, unknown> = {};
  new Function("window", "localStorage", chromeShim("https://crm.example"))(win, localStorage);
  const chrome = win["chrome"] as { storage: { local: { get: (k: unknown) => Promise<Record<string, unknown>>; set: (v: object) => Promise<void> } } };
  return { local: chrome.storage.local, data };
}

describe("chrome shim do desktop", () => {
  it("baseUrl é sempre o CRM do app, mesmo gravado pela página", async () => {
    const { local, data } = load(JSON.stringify({ baseUrl: "https://evil.example", autoSend: { a: "en" } }));
    expect(await local.get(["baseUrl", "autoSend"])).toEqual({
      baseUrl: "https://crm.example",
      autoSend: { a: "en" },
    });
    await local.set({ baseUrl: "https://evil.example", x: 1 });
    expect(JSON.parse(data.get("adrCrmStorage")!)).not.toHaveProperty("baseUrl");
  });

  it("JSON corrompido pela página vira vazio, não exceção", async () => {
    const { local } = load("{quebrado");
    expect(await local.get(["autoSend"])).toEqual({ autoSend: undefined });
    await expect(local.set({ autoSend: {} })).resolves.toBeUndefined();
  });
});
