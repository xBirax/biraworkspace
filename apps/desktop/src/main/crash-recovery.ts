import type { ViewLifecycle, ViewState } from "@adr/view-lifecycle";

export type RecoverableView = {
  id: string;
  kind: string;
  lifecycle: ViewLifecycle;
  recreate: () => void;
};

/**
 * Refinement 19 — recover a single crashed view without quitting the app.
 */
export class CrashRecoveryRegistry {
  #views = new Map<string, RecoverableView>();

  register(view: RecoverableView): void {
    this.#views.set(view.id, view);
  }

  unregister(id: string): void {
    this.#views.delete(id);
  }

  handleRenderProcessGone(id: string): { recovered: boolean; state?: ViewState } {
    const view = this.#views.get(id);
    if (!view) return { recovered: false };

    try {
      if (view.lifecycle.state === "active" || view.lifecycle.state === "background" || view.lifecycle.state === "loading") {
        view.lifecycle.transition("failed");
      }
    } catch {
      // already failed / suspended
    }

    view.recreate();

    try {
      if (view.lifecycle.state === "failed" || view.lifecycle.state === "not_created") {
        view.lifecycle.transition("loading");
      }
    } catch {
      // ignore illegal transition if recreate already advanced state
    }

    return { recovered: true, state: view.lifecycle.state };
  }

  get size(): number {
    return this.#views.size;
  }
}
