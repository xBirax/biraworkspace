import { describe, expect, it } from "vitest";
import { createEmptyAppState } from "@adr/app-state";
import { createWorkspace } from "@adr/workspaces";
import {
  addWhatsAppInstance,
  assertWhatsAppPartitionsIsolated,
  listWhatsAppInstances,
  partitionNamesForWhatsApps,
  renameWhatsAppInstance,
  restoreDeletedService,
  softDeleteService,
  updateWhatsAppBadge,
} from "../src/whatsapp-instances.js";

describe("multi WhatsApp isolation", () => {
  it("keeps ten named profiles on distinct partitions", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, {
      name: "Ops",
      color: "#4da3ff",
      crmProfileId: "crm-1",
    });
    const workspaceId = state.workspaces[0]!.id;

    for (let i = 1; i <= 10; i += 1) {
      state = addWhatsAppInstance(state, {
        workspaceId,
        name: `WA ${i}`,
      });
    }

    const instances = listWhatsAppInstances(state, workspaceId);
    expect(instances).toHaveLength(10);
    state = renameWhatsAppInstance(state, instances[0]!.id, "Pessoal");
    expect(listWhatsAppInstances(state, workspaceId)[0]?.name).toBe("Pessoal");

    const partitions = partitionNamesForWhatsApps(state, workspaceId);
    expect(partitions).toHaveLength(10);
    assertWhatsAppPartitionsIsolated(partitions);

    let badges = updateWhatsAppBadge([], instances[1]!.id, 3, "3");
    badges = updateWhatsAppBadge(badges, instances[1]!.id, 0);
    expect(badges).toHaveLength(0);
  });
});

describe("restoreDeletedService", () => {
  const setup = () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, { name: "Ops", color: "#4da3ff", crmProfileId: "crm-1" });
    const workspaceId = state.workspaces[0]!.id;
    for (const name of ["A", "B", "C"]) state = addWhatsAppInstance(state, { workspaceId, name });
    const ids = listWhatsAppInstances(state, workspaceId).map((s) => s.id);
    return { state, workspaceId, ids };
  };

  it("devolve o serviço na mesma posição, com a mesma partição", () => {
    const { state, workspaceId, ids } = setup();
    const before = state.services.find((s) => s.id === ids[1])!;
    const deleted = softDeleteService(state, ids[1]!);
    const restored = restoreDeletedService(deleted, ids[1]!, 1);
    const workspace = restored.workspaces.find((w) => w.id === workspaceId)!;
    expect(workspace.serviceInstanceIds.filter((id) => ids.includes(id))).toEqual(ids);
    const service = restored.services.find((s) => s.id === ids[1])!;
    expect(service.deletedAt).toBeUndefined();
    expect(service.profileId).toBe(before.profileId);
  });

  it("vai para o fim quando a posição não existe mais", () => {
    const { state, workspaceId, ids } = setup();
    const restored = restoreDeletedService(softDeleteService(state, ids[0]!), ids[0]!, 99);
    const workspace = restored.workspaces.find((w) => w.id === workspaceId)!;
    expect(workspace.serviceInstanceIds.at(-1)).toBe(ids[0]);
  });

  it("recusa serviço que não está excluído", () => {
    const { state, ids } = setup();
    expect(() => restoreDeletedService(state, ids[0]!)).toThrow();
  });
});
