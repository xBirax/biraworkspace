import { Menu, type BaseWindow, type MenuItemConstructorOptions } from "electron";
import { MENU_CLOSE_GRACE_MS, createOneShot } from "./one-shot-choice.js";

/**
 * Menu nativo de escolha (conta Google, negócio do CRM, tela a compartilhar).
 *
 * Resolve com o valor do item clicado, ou `undefined` se o menu fechou sem
 * escolha (ou num item "cancelar"). O fechamento do menu pode chegar ANTES do
 * clique do item (Windows): só depois de MENU_CLOSE_GRACE_MS ele conta como
 * desistência — e um clique que chegue depois disso é ignorado (ver
 * one-shot-choice.ts).
 */
export type PopupChoiceItem<T> =
  | { header: string }
  | { separator: true }
  | { label: string; sublabel?: string; value: T }
  | { label: string; cancel: true };

export function choiceMenuTemplate<T>(
  items: ReadonlyArray<PopupChoiceItem<T>>,
  choice: { pick: (value: T) => void; cancel: () => void },
): MenuItemConstructorOptions[] {
  return items.map((item): MenuItemConstructorOptions => {
    if ("header" in item) return { label: item.header, enabled: false };
    if ("separator" in item) return { type: "separator" };
    if ("cancel" in item) return { label: item.label, click: () => choice.cancel() };
    return {
      label: item.label,
      ...(item.sublabel ? { sublabel: item.sublabel } : {}),
      click: () => choice.pick(item.value),
    };
  });
}

export function popupChoice<T>(window: BaseWindow, items: ReadonlyArray<PopupChoiceItem<T>>): Promise<T | undefined> {
  return new Promise((resolve) => {
    const choice = createOneShot<T>(resolve, () => resolve(undefined));
    Menu.buildFromTemplate(choiceMenuTemplate(items, choice)).popup({
      window,
      callback: () => setTimeout(() => choice.cancel(), MENU_CLOSE_GRACE_MS),
    });
  });
}
