import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../preload/form-activity-preload.cjs", import.meta.url), "utf8");

describe("rastreador isolado de edições", () => {
  it("ouve desde o preload, não confunde documento salvo com edição e libera campos vazios/removidos", () => {
    const field = { isContentEditable: true, isConnected: true, innerText: "Documento salvo", closest: () => field };
    const listeners = new Map<string, (event: { target: unknown }) => void>();
    let bridge!: { hasEdits: () => boolean };
    runInNewContext(source, {
      require: () => ({ contextBridge: { exposeInMainWorld: (_name: string, api: typeof bridge) => { bridge = api; } } }),
      document: {
        addEventListener: (name: string, listener: (event: { target: unknown }) => void) => listeners.set(name, listener),
        querySelectorAll: () => [field],
      },
    });
    expect(bridge.hasEdits()).toBe(false);
    listeners.get("input")!({ target: field });
    expect(bridge.hasEdits()).toBe(true);
    field.isConnected = false;
    expect(bridge.hasEdits()).toBe(false);
    field.isConnected = true;
    field.innerText = "";
    expect(bridge.hasEdits()).toBe(false);
  });
});
