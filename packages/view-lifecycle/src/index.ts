export type ViewState =
  | "not_created"
  | "loading"
  | "active"
  | "background"
  | "suspended"
  | "failed";

const ALLOWED: Record<ViewState, readonly ViewState[]> = {
  not_created: ["loading"],
  loading: ["active", "failed", "suspended"],
  active: ["background", "failed", "suspended"],
  background: ["active", "suspended", "failed"],
  suspended: ["loading", "not_created"],
  failed: ["loading", "not_created"],
};

export class ViewLifecycle {
  #state: ViewState = "not_created";

  get state(): ViewState {
    return this.#state;
  }

  transition(next: ViewState): ViewState {
    const allowed = ALLOWED[this.#state];
    if (!allowed.includes(next)) {
      throw new Error(`transição inválida: ${this.#state} -> ${next}`);
    }
    this.#state = next;
    return this.#state;
  }
}

export function canDestroyWebContents(state: ViewState): boolean {
  return state === "suspended" || state === "failed" || state === "background";
}

export {
  CRM_VIEW_ID,
  HIBERNATE_AFTER_MS,
  HIBERNATE_MINIMIZED_MS,
  hibernateAfterMs,
  keepAwakeBlocksHibernation,
  maxLoadedViewsUnderPressure,
  memoryBudgetBytes,
  memoryPressure,
  pickViewsToHibernate,
  shouldHibernateForIdle,
  recommendedMaxLoadedViews,
  type HibernateCandidate,
  type MemoryPressure,
} from "./hibernate.js";

export {
  MEDIA_ACTIVE_PROBE,
  shouldBlockHibernation,
  type MediaProbeResult,
} from "./media-active.js";

