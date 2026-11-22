import { describe, expect, it } from "vitest";
import { createEmptyAppState } from "@adr/app-state";
import { createWorkspace } from "@adr/workspaces";
import {
  SERVICE_PRESETS,
  createServiceInstance,
  expectedAdapterFor,
  getPreset,
} from "../src/index.js";

describe("service presets", () => {
  it("assigns adapter, URL and profile kind for each service", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, {
      name: "Main",
      color: "#4da3ff",
      crmProfileId: "crm-1",
    });
    const workspaceId = state.workspaces[0]!.id;

    for (const preset of SERVICE_PRESETS) {
      expect(getPreset(preset.kind).startUrl).toBe(preset.startUrl);
      expect(expectedAdapterFor(preset.kind)).toBeTruthy();
      state = createServiceInstance(state, {
        workspaceId,
        kind: preset.kind,
        profileId: `${preset.profileKind}-profile`,
      });
    }

    expect(state.services).toHaveLength(SERVICE_PRESETS.length);
    expect(state.workspaces[0]?.serviceInstanceIds).toHaveLength(SERVICE_PRESETS.length);
    expect(state.services.map((s) => s.kind).sort()).toEqual(
      SERVICE_PRESETS.map((p) => p.kind).slice().sort(),
    );
  });
});
