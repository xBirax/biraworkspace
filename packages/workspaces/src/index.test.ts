import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyAppState, saveAppStateAtomic, loadAppState } from "@adr/app-state";
import {
  createWorkspace,
  renameWorkspace,
  reorderWorkspaces,
  setActiveWorkspace,
  softDeleteWorkspace,
  restoreWorkspace,
  purgeWorkspace,
  purgeExpiredWorkspaces,
  SOFT_DELETE_RETENTION_MS,
  restoreWorkspacesFromSnapshots,
  listActiveWorkspaces,
  reorderWorkspaceServices,
  orderedServicesForWorkspace,
  reorderWorkspaceRail,
  railOrderForWorkspace,
  CRM_RAIL_ID,
} from "../src/index.js";

describe("workspaces", () => {
  it("survives three restart snapshots", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-ws-"));
    const file = path.join(dir, "state.v1.json");
    let state = createEmptyAppState();
    state = createWorkspace(state, {
      name: "Alpha",
      color: "#4da3ff",
      crmProfileId: "crm-1",
    });
    const firstId = state.workspaces[0]!.id;
    state = createWorkspace(state, {
      name: "Beta",
      color: "#22c55e",
      crmProfileId: "crm-2",
    });
    state = renameWorkspace(state, firstId, "Alpha Ops");
    state = reorderWorkspaces(state, [state.workspaces[1]!.id, firstId]);
    state = setActiveWorkspace(state, firstId);

    const snaps: ReturnType<typeof createEmptyAppState>[] = [];
    for (let i = 0; i < 3; i += 1) {
      saveAppStateAtomic(file, state);
      const loaded = loadAppState(file);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        snaps.push(loaded.state);
        state = loaded.state;
      }
    }

    const restored = restoreWorkspacesFromSnapshots(snaps);
    expect(restored.workspaces).toHaveLength(2);
    expect(restored.workspaces.find((w) => w.id === firstId)?.name).toBe("Alpha Ops");
    expect(restored.activeWorkspaceId).toBe(firstId);

    state = softDeleteWorkspace(state, state.workspaces[0]!.id);
    expect(listActiveWorkspaces(state)).toHaveLength(1);
    expect(state.workspaces).toHaveLength(2);
  });

  it("reorders services inside a workspace", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, { name: "A", color: "#4da3ff", crmProfileId: "c1" });
    const ws = state.workspaces[0]!.id;
    state = {
      ...state,
      services: [
        {
          id: "s1",
          workspaceId: ws,
          kind: "whatsapp",
          name: "WA1",
          startUrl: "https://web.whatsapp.com/",
          profileId: "p1",
          pinned: false,
          keepAwake: false,
        },
        {
          id: "s2",
          workspaceId: ws,
          kind: "gmail",
          name: "Gmail",
          startUrl: "https://mail.google.com/",
          profileId: "p2",
          pinned: false,
          keepAwake: false,
        },
      ],
      workspaces: state.workspaces.map((w) =>
        w.id === ws ? { ...w, serviceInstanceIds: ["s1", "s2"] } : w,
      ),
    };
    state = reorderWorkspaceServices(state, ws, ["s2", "s1"]);
    expect(state.workspaces[0]?.serviceInstanceIds).toEqual(["s2", "s1"]);
    expect(orderedServicesForWorkspace(state, ws).map((s) => s.id)).toEqual(["s2", "s1"]);
    state = {
      ...state,
      services: state.services.map((service) =>
        service.id === "s1" ? { ...service, pinned: true } : service,
      ),
    };
    expect(orderedServicesForWorkspace(state, ws).map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("reorders the rail with the CRM tile spliced in", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, { name: "A", color: "#4da3ff", crmProfileId: "c1" });
    const ws = state.workspaces[0]!.id;
    state = {
      ...state,
      services: ["s1", "s2", "s3"].map((id) => ({
        id,
        workspaceId: ws,
        kind: "browser" as const,
        name: id,
        startUrl: "https://example.com/",
        profileId: `p-${id}`,
        pinned: false,
        keepAwake: false,
      })),
      workspaces: state.workspaces.map((w) =>
        w.id === ws ? { ...w, serviceInstanceIds: ["s1", "s2", "s3"] } : w,
      ),
    };

    // CRM starts first by default.
    expect(railOrderForWorkspace(state, ws)).toEqual([CRM_RAIL_ID, "s1", "s2", "s3"]);

    state = reorderWorkspaceRail(state, ws, ["s2", CRM_RAIL_ID, "s1", "s3"]);
    expect(state.workspaces[0]?.crmPosition).toBe(1);
    expect(railOrderForWorkspace(state, ws)).toEqual(["s2", CRM_RAIL_ID, "s1", "s3"]);

    // CRM dragged to the end.
    state = reorderWorkspaceRail(state, ws, ["s2", "s1", "s3", CRM_RAIL_ID]);
    expect(state.workspaces[0]?.crmPosition).toBe(3);
    expect(railOrderForWorkspace(state, ws)).toEqual(["s2", "s1", "s3", CRM_RAIL_ID]);
  });

  it("soft-delete restores session metadata; purge only chosen UUID", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, {
      name: "Keep",
      color: "#111",
      crmProfileId: "crm-keep",
    });
    const keepId = state.workspaces[0]!.id;
    state = createWorkspace(state, {
      name: "Trash",
      color: "#222",
      crmProfileId: "crm-trash",
    });
    const trashId = state.workspaces.find((w) => w.id !== keepId)!.id;
    state = {
      ...state,
      services: [
        {
          id: "svc-trash",
          workspaceId: trashId,
          kind: "whatsapp",
          name: "WA",
          startUrl: "https://web.whatsapp.com/",
          profileId: "prof-trash",
          pinned: true,
          keepAwake: false,
        },
      ],
      profiles: [
        {
          id: "crm-keep",
          kind: "crm",
          name: "CRM Keep",
          partitionName: "persist:crm-crm-keep00000000000000000000",
          createdAt: new Date().toISOString(),
        },
        {
          id: "crm-trash",
          kind: "crm",
          name: "CRM Trash",
          partitionName: "persist:crm-crm-trash0000000000000000000",
          createdAt: new Date().toISOString(),
        },
        {
          id: "prof-trash",
          kind: "whatsapp",
          name: "WA Trash",
          partitionName: "persist:wa-prof-trash0000000000000000000",
          createdAt: new Date().toISOString(),
        },
      ],
    };

    state = softDeleteWorkspace(state, trashId);
    expect(state.workspaces.find((w) => w.id === trashId)?.deletedAt).toBeTruthy();
    expect(state.services[0]?.deletedAt).toBeTruthy();
    expect(listActiveWorkspaces(state).map((w) => w.id)).toEqual([keepId]);

    state = restoreWorkspace(state, trashId);
    expect(state.workspaces.find((w) => w.id === trashId)?.deletedAt).toBeUndefined();
    expect(state.services[0]?.deletedAt).toBeUndefined();

    const deletedAt = new Date(Date.now() - SOFT_DELETE_RETENTION_MS - 1000).toISOString();
    state = softDeleteWorkspace(state, trashId, deletedAt);
    const { state: purged, purgedIds } = purgeExpiredWorkspaces(state);
    expect(purgedIds).toEqual([trashId]);
    expect(purged.workspaces.map((w) => w.id)).toEqual([keepId]);
    expect(purged.services).toHaveLength(0);
    expect(purged.profiles.every((p) => p.id !== "crm-trash")).toBe(true);
    expect(purged.profiles.some((p) => p.id === "crm-keep")).toBe(true);

    expect(() => purgeWorkspace(purged, keepId)).toThrow(/soft-delete/);
  });
});

describe("purge com serviço estacionado", () => {
  it("mantém o perfil do serviço estacionado de outro workspace e descarta os do apagado", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, { name: "A", color: "#000", crmProfileId: "crm-a" });
    state = createWorkspace(state, { name: "B", color: "#000", crmProfileId: "crm-b" });
    const [a, b] = state.workspaces;
    const profile = (id: string) => ({
      id,
      kind: "browser" as const,
      name: id,
      partitionName: `persist:browser-${id}`,
      createdAt: "",
    });
    state = {
      ...state,
      profiles: [profile("p-a"), profile("p-b")],
      parkedServices: [
        { id: "s-a", workspaceId: a!.id, kind: "futuro", profileId: "p-a" },
        { id: "s-b", workspaceId: b!.id, kind: "futuro", profileId: "pp-b" },
        { id: "s-c", workspaceId: a!.id, kind: "futuro", profileId: "pp-a" },
      ],
      // Perfil de tipo também desconhecido, de cada workspace.
      parkedProfiles: [
        { id: "pp-a", kind: "perfil-futuro", name: "a", partitionName: "persist:x-a", createdAt: "" },
        { id: "pp-b", kind: "perfil-futuro", name: "b", partitionName: "persist:x-b", createdAt: "" },
      ],
    };
    state = softDeleteWorkspace(state, b!.id);
    state = purgeWorkspace(state, b!.id);
    expect(state.parkedServices.map((s) => s["id"])).toEqual(["s-a", "s-c"]);
    expect(state.profiles.map((p) => p.id)).toEqual(["p-a"]);
    // O perfil estacionado do workspace apagado sai; o do que ficou, fica.
    expect(state.parkedProfiles.map((p) => p["id"])).toEqual(["pp-a"]);
  });
  it("restaurar o workspace não ressuscita serviço excluído antes dele", () => {
    let state = createWorkspace(createEmptyAppState(), { name: "A", color: "#000", crmProfileId: "p" });
    const wsId = state.workspaces.at(-1)!.id;
    const gmail = {
      id: "gm-old",
      workspaceId: wsId,
      kind: "gmail" as const,
      name: "Gmail",
      startUrl: "https://mail.google.com/",
      profileId: "p",
      pinned: false,
      keepAwake: false,
      deletedAt: "2026-01-01T00:00:00.000Z",
    };
    state = { ...state, services: [...state.services, gmail] };
    state = restoreWorkspace(softDeleteWorkspace(state, wsId, "2026-02-01T00:00:00.000Z"), wsId);
    expect(state.services.find((s) => s.id === gmail.id)?.deletedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
