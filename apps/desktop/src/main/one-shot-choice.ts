/**
 * Escolha de menu nativo que só pode ser respondida UMA vez.
 *
 * O `callback` de fechamento do `Menu.popup` pode chegar antes do `click` do
 * item (Windows). Os menus de escolha (popup-choice.ts: conta Google, negócio, tela)
 * esperam um pouco antes de tratar "fechou sem escolher" como cancelamento; se
 * o clique chegar DEPOIS disso, ele é ignorado — senão o fluxo seria cancelado
 * e logo em seguida iniciado (popup de login fechado e janela de conta aberta).
 */

/** Espera depois de o menu fechar antes de contar como "não escolheu". */
export const MENU_CLOSE_GRACE_MS = 1500;

export function createOneShot<T>(onPick: (value: T) => void, onCancel: () => void) {
  let settled = false;
  return {
    pick(value: T): void {
      if (settled) return;
      settled = true;
      onPick(value);
    },
    cancel(): void {
      if (settled) return;
      settled = true;
      onCancel();
    },
    get settled(): boolean {
      return settled;
    },
  };
}
