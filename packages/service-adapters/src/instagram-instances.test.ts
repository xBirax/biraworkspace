import { describe, expect, it } from "vitest";
import { createEmptyAppState } from "@adr/app-state";
import { createWorkspace } from "@adr/workspaces";
import {
  addInstagramInstance,
  assertInstagramPartitionsIsolated,
  listInstagramInstances,
  partitionNamesForInstagrams,
  renameInstagramInstance,
} from "./instagram-instances.js";
import { softDeleteService } from "./whatsapp-instances.js";

describe("multi Instagram isolation", () => {
  it("keeps several named accounts on distinct partitions", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, {
      name: "Ops",
      color: "#4da3ff",
      crmProfileId: "crm-1",
    });
    const workspaceId = state.workspaces[0]!.id;

    for (let i = 1; i <= 5; i += 1) {
      state = addInstagramInstance(state, {
        workspaceId,
        name: `Instagram ${i}`,
      });
    }

    const instances = listInstagramInstances(state, workspaceId);
    expect(instances).toHaveLength(5);
    state = renameInstagramInstance(state, instances[0]!.id, "Loja");
    expect(listInstagramInstances(state, workspaceId)[0]?.name).toBe("Loja");

    const partitions = partitionNamesForInstagrams(state, workspaceId);
    expect(partitions).toHaveLength(5);
    assertInstagramPartitionsIsolated(partitions);
    for (const p of partitions) {
      expect(p).toMatch(/^persist:instagram-/);
    }
  });

  it("rejects renaming a non-Instagram service", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, {
      name: "Ops",
      color: "#4da3ff",
      crmProfileId: "crm-1",
    });
    const workspaceId = state.workspaces[0]!.id;
    state = addInstagramInstance(state, { workspaceId, name: "Instagram" });
    expect(() => renameInstagramInstance(state, "not-a-real-id", "Novo Nome")).toThrow();
  });

  it("soft-delete (generic, kind-agnostic) removes an Instagram account from the workspace rail", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, {
      name: "Ops",
      color: "#4da3ff",
      crmProfileId: "crm-1",
    });
    const workspaceId = state.workspaces[0]!.id;
    state = addInstagramInstance(state, { workspaceId, name: "Instagram" });
    const id = listInstagramInstances(state, workspaceId)[0]!.id;
    state = softDeleteService(state, id);
    expect(listInstagramInstances(state, workspaceId)).toHaveLength(0);
    const ws = state.workspaces.find((w) => w.id === workspaceId)!;
    expect(ws.serviceInstanceIds).not.toContain(id);
  });
});
