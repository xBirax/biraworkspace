import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const menus = vi.hoisted(() => ({
  last: null as null | { template: Array<{ label?: string; click?: () => void }>; close: () => void },
}));
vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate: (template: Array<{ label?: string; click?: () => void }>) => ({
      popup: (options: { callback: () => void }) => {
        menus.last = { template, close: options.callback };
      },
    }),
  },
}));

import { MENU_CLOSE_GRACE_MS } from "./one-shot-choice.js";
import { choiceMenuTemplate, popupChoice } from "./popup-choice.js";

const click = (label: string) => menus.last!.template.find((item) => item.label === label)!.click!();

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("choiceMenuTemplate", () => {
  it("título desabilitado, separador, sublabel só quando há", () => {
    const template = choiceMenuTemplate(
      [
        { header: "Qual?" },
        { separator: true },
        { label: "a@x.com", sublabel: "Google", value: 1 },
        { label: "Sem sublabel", value: 2 },
        { label: "Cancelar", cancel: true },
      ],
      { pick: () => undefined, cancel: () => undefined },
    );
    expect(template[0]).toEqual({ label: "Qual?", enabled: false });
    expect(template[1]).toEqual({ type: "separator" });
    expect(template[2]).toMatchObject({ label: "a@x.com", sublabel: "Google" });
    expect(template[3]).not.toHaveProperty("sublabel");
  });
});

describe("popupChoice", () => {
  it("clique no item resolve com o valor, mesmo que o fechamento chegue antes", async () => {
    const pending = popupChoice({} as never, [{ label: "Um", value: "um" }]);
    menus.last!.close();
    click("Um");
    await expect(pending).resolves.toBe("um");
  });

  it("fechou sem escolher: undefined só depois do prazo, e clique atrasado é ignorado", async () => {
    let result: string | undefined | "pendente" = "pendente";
    void popupChoice({} as never, [{ label: "Um", value: "um" }]).then((value) => (result = value));
    menus.last!.close();
    await vi.advanceTimersByTimeAsync(MENU_CLOSE_GRACE_MS - 1);
    expect(result).toBe("pendente");
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBeUndefined();
    click("Um");
    await Promise.resolve();
    expect(result).toBeUndefined();
  });

  it("item 'Cancelar' resolve undefined; valor null é escolha válida", async () => {
    const cancel = popupChoice<string | null>({} as never, [{ label: "Cancelar", cancel: true }]);
    click("Cancelar");
    await expect(cancel).resolves.toBeUndefined();
    const none = popupChoice<string | null>({} as never, [{ label: "Sem negócio", value: null }]);
    click("Sem negócio");
    await expect(none).resolves.toBeNull();
  });
});
