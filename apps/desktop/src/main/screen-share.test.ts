import { describe, expect, it, vi } from "vitest";
import { createScreenShare } from "./screen-share.js";

const mocks = vi.hoisted(() => ({ fromFrame: vi.fn(), getSources: vi.fn(), choice: vi.fn() }));
vi.mock("electron", () => ({
  webContents: { fromFrame: mocks.fromFrame },
  desktopCapturer: { getSources: mocks.getSources },
}));
vi.mock("./popup-choice.js", () => ({ popupChoice: mocks.choice }));

describe("seleção de captura no Meet", () => {
  it.each(["aceitar", "cancelar", "trocar a conta", "navegar", "perder foco"])("%s", async (action) => {
    const frame = { parent: null };
    const origin = "https://meet.google.com";
    let focused = true;
    let front = true;
    let url = origin;
    const contents = { mainFrame: frame, getURL: () => url, isDestroyed: () => false };
    const source = { id: "screen:1", name: "Tela" };
    mocks.fromFrame.mockReturnValue(contents);
    mocks.getSources.mockResolvedValue([source]);
    mocks.choice.mockImplementation(async () => {
      if (action === "perder foco") focused = false;
      if (action === "trocar a conta") front = false;
      if (action === "navegar") url = "https://example.org";
      return action === "cancelar" ? undefined : { sourceId: source.id };
    });
    const register = vi.fn();
    createScreenShare({
      parentWindow: { isFocused: () => focused } as never,
      viewMeta: new WeakMap([[contents, { kind: "meet" }]]) as never,
      isFrontView: () => front, log: () => {},
    })({ setDisplayMediaRequestHandler: register } as never);
    const result = await new Promise(resolve => register.mock.calls[0]![0]({ frame, securityOrigin: origin }, resolve));
    expect(result).toEqual(action === "aceitar" ? { video: source } : null);
  });
});
