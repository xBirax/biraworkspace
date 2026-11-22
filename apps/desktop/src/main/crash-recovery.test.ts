import { describe, expect, it } from "vitest";
import { ViewLifecycle } from "@adr/view-lifecycle";
import { CrashRecoveryRegistry } from "./crash-recovery.js";

describe("crash recovery", () => {
  it("recreates only the affected view", () => {
    const registry = new CrashRecoveryRegistry();
    let waRecreates = 0;
    let crmRecreates = 0;

    const waLife = new ViewLifecycle();
    waLife.transition("loading");
    waLife.transition("active");
    registry.register({
      id: "wa",
      kind: "whatsapp",
      lifecycle: waLife,
      recreate: () => {
        waRecreates += 1;
      },
    });

    const crmLife = new ViewLifecycle();
    crmLife.transition("loading");
    crmLife.transition("active");
    registry.register({
      id: "crm",
      kind: "crm",
      lifecycle: crmLife,
      recreate: () => {
        crmRecreates += 1;
      },
    });

    const result = registry.handleRenderProcessGone("wa");
    expect(result.recovered).toBe(true);
    expect(waRecreates).toBe(1);
    expect(crmRecreates).toBe(0);
    expect(registry.handleRenderProcessGone("missing").recovered).toBe(false);
  });
});
