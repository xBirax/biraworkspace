import {
  CRM_VIEW_ID,
  MEDIA_ACTIVE_PROBE,
  hibernateAfterMs,
  keepAwakeBlocksHibernation,
  maxLoadedViewsUnderPressure,
  memoryBudgetBytes,
  memoryPressure,
  pickViewsToHibernate,
  recommendedMaxLoadedViews,
  shouldBlockHibernation,
  shouldHibernateForIdle,
  type MediaProbeResult,
  type MemoryPressure,
} from "@adr/view-lifecycle";
import type { ServiceKind } from "@adr/contracts";
import { isMediaKind } from "./service-catalog.js";

/**
 * Quando hibernar abas (serviços e CRM): ociosidade, teto de abas carregadas
 * (LRU) e pressão de RAM — sem nunca derrubar quem está tocando áudio, em
 * reunião, baixando arquivo ou no meio de um login.
 *
 * Saiu de workspace-window.ts: as decisões ficam aqui; criar e fechar views
 * continua lá e chega em `deps`. Só o que `deps` devolve é lido, então dá para
 * testar a passada inteira com abas falsas.
 */

/** O pedaço do webContents que a hibernação consulta. */
export type HibernationContents = {
  isCurrentlyAudible: () => boolean;
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>;
};

export type HibernationCause = {
  reason: "idle" | "lru" | "optimizer" | "manual" | "removed";
  pressure?: MemoryPressure;
};

/** Sonda de mídia sem resposta em tanto tempo conta como "não sei" (não hiberna). */
export const MEDIA_PROBE_TIMEOUT_MS = 5000;
/** Sonda pendente há mais que isso (recarga no meio) não bloqueia a próxima. */
const MEDIA_PROBE_LOST_MS = 60_000;
/** Aba recém-deixada não cai pelo teto de abas: dá tempo de voltar a ela. */
export const LRU_GRACE_MS = 90_000;

export type HibernationDeps = {
  windowGone: () => boolean;
  /** Janela minimizada ou escondida: autoriza hibernar até a aba da frente. */
  nobodyWatching: () => boolean;
  /** RAM do app inteiro, em bytes (0 = sem medida). */
  appMemoryBytes: () => number;
  totalMemory: () => number;
  /** Teto configurado à mão (Configurações → Desempenho), se houver. */
  maxLoadedViewsSetting: () => number | undefined;
  downloadsInProgress: () => boolean;
  log: (message: string, extra?: unknown) => void;
  now?: () => number;

  serviceIds: () => string[];
  serviceContents: (id: string) => HibernationContents | undefined;
  serviceInfo: (id: string) => { kind: ServiceKind; keepAwake: boolean; hibernateAfterMinutes?: number | undefined } | undefined;
  /** Mensageiro com "Manter em memória": só cede em pressão crítica. */
  messengerStaysAwake: (id: string, pressure: MemoryPressure) => boolean;
  /** Último uso de cada serviço (o mapa é da janela; a passada carimba a aba da frente). */
  lastUsedAt: Map<string, number>;
  activeServiceId: () => string | null;
  /**
   * Ocupada de um jeito que a sonda de mídia não vê: sala do Meet, login Google
   * (na aba ou na janela da conta).
   */
  serviceBusy: (id: string) => Promise<boolean>;
  hibernateService: (id: string, cause: HibernationCause) => void;

  crmIds: () => string[];
  crmContents: (id: string) => HibernationContents | undefined;
  /** CRM logado (só esse pode fechar: sem login, reabrir cai na tela de entrada). */
  crmReady: (id: string) => Promise<boolean>;
  /** A superfície da frente é o CRM (de qualquer workspace). */
  crmSurfaceActive: () => boolean;
  /** A superfície da frente é o CRM DESTE workspace. */
  crmActiveFor: (id: string) => boolean;
  crmLastUsedAt: () => number;
  touchCrm: (at: number) => void;
  closeCrm: (id: string) => void;
};

export function createHibernationController(deps: HibernationDeps) {
  const now = deps.now ?? Date.now;
  let lastPressure: MemoryPressure = "normal";
  let running = false;
  /** Sonda pendente por aba, e desde quando. */
  const probesInFlight = new WeakMap<HibernationContents, number>();
  const loggedBlockers = new WeakSet<HibernationContents>();

  function currentMemoryPressure(): MemoryPressure {
    const bytes = deps.appMemoryBytes();
    const pressure = memoryPressure(bytes, deps.totalMemory());
    // Só a MUDANÇA vai ao log: roda a cada 60 s e a cada troca de aba, e uma
    // linha por passagem afogaria o diagnóstico.
    if (pressure !== lastPressure) {
      deps.log("memória", {
        pressure,
        appMb: Math.round(bytes / 1024 ** 2),
        budgetMb: Math.round(memoryBudgetBytes(deps.totalMemory()) / 1024 ** 2),
        views: deps.serviceIds().length + deps.crmIds().length,
      });
      lastPressure = pressure;
    }
    return pressure;
  }

  /**
   * Sonda de mídia com prazo. Renderer travado nunca responde o
   * executeJavaScript: sem prazo a passada ficava presa e a hibernação parava
   * até reiniciar. Uma sonda por aba no máximo (senão cada passada empilhava
   * mais uma); pendente há mais de 60 s (recarga no meio) não bloqueia mais.
   */
  function probeMedia(contents: HibernationContents, viewId?: string): Promise<MediaProbeResult> {
    const since = probesInFlight.get(contents);
    if (since !== undefined && now() - since < MEDIA_PROBE_LOST_MS) {
      return Promise.reject(new Error("sonda anterior pendente"));
    }
    const probe = contents.executeJavaScript(MEDIA_ACTIVE_PROBE, true) as Promise<MediaProbeResult>;
    const started = now();
    probesInFlight.set(contents, started);
    void probe
      .catch(() => undefined)
      .finally(() => {
        if (probesInFlight.get(contents) === started) probesInFlight.delete(contents);
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      probe,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("sonda de mídia sem resposta")), MEDIA_PROBE_TIMEOUT_MS);
      }),
    ])
      .then((result) => {
        if (result?.active && !loggedBlockers.has(contents)) {
          loggedBlockers.add(contents);
          deps.log("hibernação impedida", {
            view: viewId,
            reason: String(result.reason || "unknown").slice(0, 80),
          });
        }
        return result;
      })
      .finally(() => clearTimeout(timer));
  }

  function serviceKeepAwake(id: string, pressure: MemoryPressure): boolean {
    const info = deps.serviceInfo(id);
    if (!info) return false;
    return keepAwakeBlocksHibernation({
      keepAwake: info.keepAwake,
      pressure,
      audible: Boolean(deps.serviceContents(id)?.isCurrentlyAudible()),
      mediaService: isMediaKind(info.kind),
    });
  }

  async function canHibernate(id: string, pressure: MemoryPressure): Promise<boolean> {
    const contents = deps.serviceContents(id);
    if (!contents || !deps.serviceInfo(id)) return false;
    // WhatsApp e Gmail hibernados não notificam: ficam acordados (preferência).
    // Em pressão CRÍTICA ainda cedem — melhor perder o aviso que travar o PC.
    if (deps.messengerStaysAwake(id, pressure)) return false;
    if (deps.activeServiceId() === id && !deps.nobodyWatching()) return false;
    // Sinal do próprio Chromium: pega Web Audio também (nota de voz do WhatsApp
    // toca sem <audio>, e a sonda de DOM não a vê).
    if (contents.isCurrentlyAudible()) return false;
    // A transferência é da sessão, que pode ser de vários serviços: durante um
    // download nenhuma view fecha por iniciativa do app.
    if (deps.downloadsInProgress()) return false;
    if (serviceKeepAwake(id, pressure)) return false;
    try {
      if (await deps.serviceBusy(id)) return false;
      return !shouldBlockHibernation(await probeMedia(contents, id), false);
    } catch {
      // Sonda que falhou não prova que a aba está parada: mantém.
      return false;
    }
  }

  async function canHibernateCrm(id: string): Promise<boolean> {
    const contents = deps.crmContents(id);
    if (!contents || !(await deps.crmReady(id).catch(() => false))) return false;
    const busy = (): boolean =>
      deps.crmContents(id) !== contents ||
      (deps.crmActiveFor(id) && !deps.nobodyWatching()) ||
      contents.isCurrentlyAudible() ||
      deps.downloadsInProgress();
    try {
      if (busy()) return false;
      const probe = await probeMedia(contents, `crm:${id}`);
      // De novo depois da sonda: a pessoa pode ter voltado ao CRM nesse meio-tempo.
      return !shouldBlockHibernation(probe, false) && !busy();
    } catch {
      return false;
    }
  }

  async function hibernateInactiveCrmViews(): Promise<void> {
    for (const id of deps.crmIds()) {
      if (!(await canHibernateCrm(id))) continue;
      deps.log("hibernate crm view", id);
      deps.closeCrm(id);
    }
  }

  async function pass(): Promise<void> {
    if (deps.windowGone()) return;
    // Medido UMA vez por passagem: a janela pode voltar no meio dela.
    const hidden = deps.nobodyWatching();
    const pressure = currentMemoryPressure();
    const base = deps.maxLoadedViewsSetting() ?? recommendedMaxLoadedViews(deps.totalMemory());
    // Teto configurado continua TETO: a pressão só aperta.
    const max = maxLoadedViewsUnderPressure(base, pressure);
    const idleMs = hibernateAfterMs(pressure, hidden);
    const activeId = deps.activeServiceId();
    const at = now();
    // A aba EM USO conta como usada agora (com a janela à vista): "ociosa há
    // 10 min" se mede desde que a pessoa SAIU dela, não desde o clique que a
    // abriu. Escondida, envelhece como qualquer outra — é isso que a torna
    // elegível.
    if (!hidden) {
      if (deps.crmSurfaceActive()) deps.touchCrm(at);
      else if (activeId) deps.lastUsedAt.set(activeId, at);
    }
    for (const id of deps.serviceIds()) {
      const idle = shouldHibernateForIdle({
        lastUsedAt: deps.lastUsedAt.get(id) || 0,
        now: at,
        idleMs: hibernateAfterMs(pressure, hidden, deps.serviceInfo(id)?.hibernateAfterMinutes),
        isActive: id === activeId,
        hidden,
      });
      if (idle && (await canHibernate(id, pressure))) deps.hibernateService(id, { reason: "idle", pressure });
    }
    const candidates = deps.serviceIds().map((id) => ({
      id,
      lastUsedAt: deps.lastUsedAt.get(id) || 0,
      keepAwake: serviceKeepAwake(id, pressure) || deps.messengerStaysAwake(id, pressure),
      active: id === activeId,
    }));
    if (deps.crmIds().length) {
      candidates.push({
        id: CRM_VIEW_ID,
        lastUsedAt: deps.crmLastUsedAt(),
        keepAwake: false,
        active: deps.crmSurfaceActive(),
      });
    }
    // Graça curta, não a mesma ociosidade do passo acima: com ela o teto só
    // escolhia abas que já teriam hibernado por ociosidade — nunca agia.
    const grace = { now: at, minimumIdleMs: Math.min(idleMs, LRU_GRACE_MS) };
    for (const id of pickViewsToHibernate(candidates, max, grace)) {
      if (id === CRM_VIEW_ID) await hibernateInactiveCrmViews();
      else if (await canHibernate(id, pressure)) deps.hibernateService(id, { reason: "lru", pressure });
    }
    // Ociosidade do CRM mesmo abaixo do teto: quem passa o dia no WhatsApp não
    // deve manter o app web do CRM residente.
    if (
      deps.crmIds().length &&
      shouldHibernateForIdle({
        lastUsedAt: deps.crmLastUsedAt(),
        now: at,
        idleMs,
        isActive: deps.crmSurfaceActive(),
        hidden,
      })
    ) {
      await hibernateInactiveCrmViews();
    }
  }

  /** Uma passada por vez: roda pelo timer e por IPC (troca de aba). */
  async function enforce(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await pass();
    } finally {
      running = false;
    }
  }

  return { enforce, canHibernate, canHibernateCrm, currentMemoryPressure, probeMedia };
}

export type HibernationController = ReturnType<typeof createHibernationController>;
