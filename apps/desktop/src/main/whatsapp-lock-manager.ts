import type { AppStateV1, ServiceInstance } from "@adr/contracts";
import { parseAppState } from "@adr/app-state";
import { legacyLockedWhatsAppIds, resolveWhatsAppLocked, type WhatsAppLock } from "./whatsapp-lock.js";

export const LOCK_STORAGE_UNAVAILABLE = {
  ok: false,
  message:
    "A proteção segura do sistema está indisponível agora. Desbloqueie o chaveiro do sistema e tente novamente.",
} as const;

export type PinActionTarget =
  | { ok: true; service: ServiceInstance; lock: WhatsAppLock }
  | { ok: false; message: string };

/**
 * Regras de estado e cofre do bloqueio do WhatsApp — sem Electron, para serem
 * testadas de ponta a ponta. A janela fica só com diálogos, prompts e UI.
 *
 * Os três bugs graves do PIN nasceram aqui, na orquestração (ativar/desativar
 * UMA sessão desprotegia as outras; PIN global apagado antes de copiado); os
 * helpers puros já eram testados e não pegaram nenhum deles.
 */
export class WhatsAppLockManager {
  constructor(
    private readonly deps: {
      getState: () => AppStateV1;
      /** Grava e passa a usar `next` (já validado por parseAppState). */
      commit: (next: AppStateV1) => void;
      /** Cofre do PIN global legado (`whatsapp-lock.v1.json`). */
      legacyLock: WhatsAppLock;
      /** Cofre de uma sessão (`whatsapp-lock.<id>.v1.json`). */
      sessionLock: (serviceId: string) => WhatsAppLock;
    },
  ) {}

  isLocked(serviceId: string): boolean {
    return resolveWhatsAppLocked(serviceId, this.deps.getState().settings);
  }

  /**
   * Bloqueio global legado → um cofre por sessão, uma vez.
   *
   * Só roda com a criptografia disponível: migrar com o chaveiro travado deixaria
   * as sessões sem PIN legível — e PIN ausente abre a recuperação, que desativa
   * sem pedir o PIN. Devolve false nesse caso, para quem chamou tentar de novo.
   * Inclui as sessões excluídas: ficam restauráveis por 30 dias, e uma sessão
   * fora do mapa voltaria da lixeira sem PIN.
   */
  migrateLegacy(): boolean {
    const state = this.deps.getState();
    const legacyIds = legacyLockedWhatsAppIds(
      state.services.filter((service) => service.kind === "whatsapp").map((service) => service.id),
      state.settings,
    );
    if (!legacyIds.length) return true;
    if (this.deps.legacyLock.pinState() === "unavailable") return false;
    const lockServiceIds = { ...state.settings.whatsappLockServiceIds };
    // Copia ANTES de apagar o global. PIN legado ilegível: a sessão entra no
    // mapa sem PIN e cai na recuperação dela — protegida, como estava.
    for (const id of legacyIds) {
      this.deps.legacyLock.copyPinTo(this.deps.sessionLock(id));
      lockServiceIds[id] = true;
    }
    this.deps.commit(
      parseAppState({
        ...state,
        settings: { ...state.settings, whatsappLockServiceIds: lockServiceIds },
      }),
    );
    this.deps.legacyLock.clear();
    return true;
  }

  /**
   * Preâmbulo de toda ação de PIN: a sessão existe no workspace e o legado já
   * foi migrado — daí em diante o cofre é sempre o da própria sessão.
   */
  target(serviceId: unknown, workspaceId: string): PinActionTarget {
    const id = String(serviceId || "");
    const service = this.deps
      .getState()
      .services.find(
        (item) =>
          item.id === id &&
          item.workspaceId === workspaceId &&
          item.kind === "whatsapp" &&
          !item.deletedAt,
      );
    if (!service) return { ok: false, message: "Sessão do WhatsApp não encontrada" };
    try {
      if (!this.migrateLegacy()) return LOCK_STORAGE_UNAVAILABLE;
    } catch {
      return { ok: false, message: "Não foi possível preparar o bloqueio. Tente novamente." };
    }
    return { ok: true, service, lock: this.deps.sessionLock(id) };
  }

  /**
   * Motivo para recusar "ativar", ou null. A UI só oferece ativar com a caixa
   * desmarcada, mas a fronteira é o handler: ativar por cima de um PIN legível
   * seria trocá-lo sem pedir o atual.
   */
  enableRefusal(service: ServiceInstance, lock: WhatsAppLock): string | null {
    const pinState = lock.pinState();
    // Chaveiro travado: setPin falharia depois de o usuário digitar o PIN duas
    // vezes. E sem ler o cofre não dá para saber se já existe PIN a proteger.
    if (pinState === "unavailable") return LOCK_STORAGE_UNAVAILABLE.message;
    if (this.isLocked(service.id) && pinState === "ok") {
      return "Esta sessão já tem PIN. Use “Trocar PIN” para mudá-lo.";
    }
    return null;
  }

  /** Grava o PIN no cofre da sessão e a marca como protegida. Lança se o PIN for inválido. */
  enable(service: ServiceInstance, lock: WhatsAppLock, pin: string): void {
    lock.setPin(pin);
    const state = this.deps.getState();
    this.deps.commit(
      parseAppState({
        ...state,
        settings: {
          ...state.settings,
          whatsappLockEnabled: true,
          whatsappLockServiceIds: { ...state.settings.whatsappLockServiceIds, [service.id]: true },
        },
      }),
    );
  }

  /** Desliga o bloqueio de UMA sessão e apaga o cofre dela. As outras não mudam. */
  remove(serviceId: string, lock: WhatsAppLock): void {
    const state = this.deps.getState();
    const lockServiceIds = { ...state.settings.whatsappLockServiceIds };
    const onLeaveIds = { ...state.settings.whatsappLockOnLeaveServiceIds };
    const timeoutIds = { ...state.settings.whatsappLockTimeoutServiceMinutes };
    delete lockServiceIds[serviceId];
    delete onLeaveIds[serviceId];
    delete timeoutIds[serviceId];
    this.deps.commit(
      parseAppState({
        ...state,
        settings: {
          ...state.settings,
          whatsappLockServiceIds: lockServiceIds,
          whatsappLockOnLeaveServiceIds: onLeaveIds,
          whatsappLockTimeoutServiceMinutes: timeoutIds,
          whatsappLockEnabled: Object.values(lockServiceIds).some(Boolean),
        },
      }),
    );
    lock.clear();
  }
}
