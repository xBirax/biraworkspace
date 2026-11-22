import { describe, expect, it } from "vitest";
import { createEmptyAppState } from "@adr/app-state";
import { createWorkspace } from "@adr/workspaces";
import {
  addMicrosoftService,
  listMicrosoftProfilesForWorkspace,
  reassignServiceMicrosoftProfile,
  renameMicrosoftProfile,
} from "./microsoft-services.js";
import { softDeleteService } from "./whatsapp-instances.js";

const workspace = () => {
  const state = createWorkspace(createEmptyAppState(), { name: "A", color: "#1", crmProfileId: "c1" });
  return { state, ws: state.workspaces[0]!.id };
};

describe("contas Microsoft", () => {
  it("Outlook e Teams da mesma conta dividem a sessão", () => {
    const { ws, state: initial } = workspace();
    let state = initial;
    state = addMicrosoftService(state, { workspaceId: ws, kind: "outlook" });
    state = addMicrosoftService(state, { workspaceId: ws, kind: "teams" });
    const [account] = listMicrosoftProfilesForWorkspace(state, ws);
    expect(listMicrosoftProfilesForWorkspace(state, ws)).toHaveLength(1);
    expect(account!.partitionName).toMatch(/^persist:ms-/);
    expect(state.services.every((s) => s.profileId === account!.id)).toBe(true);
  });

  it("outra conta é outro perfil; o mesmo serviço duas vezes sem conta nova é recusado", () => {
    const { ws, state: initial } = workspace();
    let state = initial;
    state = addMicrosoftService(state, { workspaceId: ws, kind: "outlook" });
    expect(() => addMicrosoftService(state, { workspaceId: ws, kind: "outlook" })).toThrow(/já adicionado/);
    state = addMicrosoftService(state, { workspaceId: ws, kind: "outlook", name: "Outlook 2", newAccount: true });
    const accounts = listMicrosoftProfilesForWorkspace(state, ws);
    expect(accounts.map((a) => a.name)).toEqual(["Microsoft", "Microsoft 2"]);
    expect(accounts[0]!.partitionName).not.toBe(accounts[1]!.partitionName);
  });

  it("conta nova nunca repete o nome de outra do workspace, nem de serviço removido", () => {
    const { ws, state: initial } = workspace();
    let state = addMicrosoftService(initial, { workspaceId: ws, kind: "outlook" });
    state = addMicrosoftService(state, { workspaceId: ws, kind: "teams", newAccount: true });
    state = softDeleteService(state, state.services.find((s) => s.kind === "outlook")!.id);
    state = addMicrosoftService(state, { workspaceId: ws, kind: "outlook", newAccount: true });
    expect(listMicrosoftProfilesForWorkspace(state, ws).map((a) => a.name)).toEqual([
      "Microsoft 2",
      "Microsoft 3",
    ]);
  });

  it("Outlook removido e adicionado de novo volta na mesma conta já logada, no mesmo endereço", () => {
    const { ws, state: initial } = workspace();
    let state = addMicrosoftService(initial, { workspaceId: ws, kind: "outlook" });
    const first = state.services[0]!;
    state = {
      ...state,
      services: state.services.map((s) => ({ ...s, startUrl: "https://outlook.live.com/mail/" })),
    };
    state = softDeleteService(state, first.id);
    expect(listMicrosoftProfilesForWorkspace(state, ws)).toHaveLength(0);
    state = addMicrosoftService(state, { workspaceId: ws, kind: "outlook" });
    const again = state.services.find((s) => s.kind === "outlook" && !s.deletedAt)!;
    expect(again.profileId).toBe(first.profileId);
    expect(again.startUrl).toBe("https://outlook.live.com/mail/");
    // Teams depois disso entra na mesma conta, no endereço padrão dele.
    state = addMicrosoftService(state, { workspaceId: ws, kind: "teams" });
    expect(state.services.find((s) => s.kind === "teams")!.profileId).toBe(first.profileId);
    expect(state.services.find((s) => s.kind === "teams")!.startUrl).toBe("https://teams.microsoft.com/");
    // "Outra conta" continua criando conta nova.
    state = addMicrosoftService(state, { workspaceId: ws, kind: "outlook", newAccount: true });
    expect(listMicrosoftProfilesForWorkspace(state, ws)).toHaveLength(2);
  });

  it("reaproveita a conta do mesmo tipo de serviço removido, não a do último removido", () => {
    const { ws, state: initial } = workspace();
    let state = addMicrosoftService(initial, { workspaceId: ws, kind: "outlook" });
    state = addMicrosoftService(state, { workspaceId: ws, kind: "teams", newAccount: true });
    const outlook = state.services.find((s) => s.kind === "outlook")!;
    const teams = state.services.find((s) => s.kind === "teams")!;
    state = softDeleteService(state, outlook.id, "2026-10-12T10:00:00.000Z");
    state = softDeleteService(state, teams.id, "2026-10-13T10:00:00.000Z");
    state = addMicrosoftService(state, { workspaceId: ws, kind: "outlook" });
    expect(state.services.find((s) => s.kind === "outlook" && !s.deletedAt)!.profileId).toBe(outlook.profileId);
  });

  it("trocar a conta do serviço volta o endereço para o padrão", () => {
    const { ws, state: initial } = workspace();
    let state = addMicrosoftService(initial, { workspaceId: ws, kind: "outlook" });
    state = addMicrosoftService(state, { workspaceId: ws, kind: "teams", newAccount: true });
    const outlook = state.services.find((s) => s.kind === "outlook")!;
    const other = state.services.find((s) => s.kind === "teams")!.profileId;
    state = {
      ...state,
      services: state.services.map((s) => (s.id === outlook.id ? { ...s, startUrl: "https://outlook.live.com/mail/" } : s)),
    };
    state = reassignServiceMicrosoftProfile(state, outlook.id, other);
    expect(state.services.find((s) => s.id === outlook.id)!.startUrl).toBe("https://outlook.office.com/mail/");
  });

  it("renomeia a conta e troca a conta de um serviço só dentro do workspace", () => {
    const { ws, state: initial } = workspace();
    let state = initial;
    state = addMicrosoftService(state, { workspaceId: ws, kind: "outlook" });
    state = addMicrosoftService(state, { workspaceId: ws, kind: "teams", newAccount: true });
    const [first, second] = listMicrosoftProfilesForWorkspace(state, ws);
    state = renameMicrosoftProfile(state, second!.id, "ADR");
    expect(state.profiles.find((p) => p.id === second!.id)!.name).toBe("ADR");
    const teams = state.services.find((s) => s.kind === "teams")!;
    state = reassignServiceMicrosoftProfile(state, teams.id, first!.id);
    expect(state.services.find((s) => s.id === teams.id)!.profileId).toBe(first!.id);
    expect(() => reassignServiceMicrosoftProfile(state, teams.id, "outro")).toThrow(/não pertence/);
    expect(() => renameMicrosoftProfile(state, first!.id, "  ")).toThrow(/obrigatório/);
  });
});
