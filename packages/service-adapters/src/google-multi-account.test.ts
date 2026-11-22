import { describe, expect, it } from "vitest";
import { createEmptyAppState } from "@adr/app-state";
import { createWorkspace } from "@adr/workspaces";
import {
  addGoogleAccountService,
  addGmailAndCalendar,
  ensureWorkspaceGoogleProfile,
  listGoogleProfilesForWorkspace,
  migrateServicesToSharedGoogleProfile,
  renameGoogleProfile,
  reassignServiceGoogleProfile,
  googlePartitionForProfile,
} from "./google-services.js";
import { createServiceInstance, getPreset } from "./presets.js";
import { createWhatsAppProfile } from "./whatsapp-instances.js";

describe("central de contas — múltiplas contas Google por workspace", () => {
  it("cada conta nova ganha sua própria sessão isolada, sem reaproveitar a existente", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, { name: "A", color: "#1", crmProfileId: "c1" });
    const ws = state.workspaces[0]!.id;

    // Conta 1: fluxo já existente (Gmail/Calendar compartilhados)
    state = addGmailAndCalendar(state, ws);
    const profile1 = listGoogleProfilesForWorkspace(state, ws)[0]!;

    // Conta 2: nova, isolada — YouTube com outra conta Google
    const added = addGoogleAccountService(state, {
      workspaceId: ws,
      kind: "youtube",
      name: "YouTube (Loja X)",
    });
    state = added.state;

    const profiles = listGoogleProfilesForWorkspace(state, ws);
    expect(profiles).toHaveLength(2);
    expect(added.profile.partitionName).not.toBe(profile1.partitionName);
    expect(added.profile.partitionName).toMatch(/^persist:google-/);

    const ytService = state.services.find((s) => s.kind === "youtube")!;
    expect(ytService.profileId).toBe(added.profile.id);
    expect(ytService.name).toBe("YouTube (Loja X)");
  });

  it("a migração de boot não junta as contas de volta", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, { name: "A", color: "#1", crmProfileId: "c1" });
    const ws = state.workspaces[0]!.id;
    state = addGmailAndCalendar(state, ws);
    const second = addGoogleAccountService(state, { workspaceId: ws, kind: "youtube" });
    state = second.state;

    // migrateServicesToSharedGoogleProfile roda em TODO boot.
    const rebooted = migrateServicesToSharedGoogleProfile(
      migrateServicesToSharedGoogleProfile(state),
    );

    expect(listGoogleProfilesForWorkspace(rebooted, ws)).toHaveLength(2);
    expect(rebooted.services.find((s) => s.kind === "youtube")?.profileId).toBe(second.profile.id);
    expect(rebooted.services.find((s) => s.kind === "gmail")?.profileId).not.toBe(
      second.profile.id,
    );
  });

  it("permite renomear uma conta e reatribuir um serviço para outra conta já logada", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, { name: "A", color: "#1", crmProfileId: "c1" });
    const ws = state.workspaces[0]!.id;

    const first = addGoogleAccountService(state, { workspaceId: ws, kind: "gmail" });
    state = first.state;
    const second = addGoogleAccountService(state, { workspaceId: ws, kind: "youtube" });
    state = second.state;

    state = renameGoogleProfile(state, first.profile.id, "  Conta Pessoal  ");
    expect(state.profiles.find((p) => p.id === first.profile.id)?.name).toBe("Conta Pessoal");

    // Reaproveita a conta do Gmail também para o Calendar, sem logar de novo
    state = createServiceInstance(state, {
      workspaceId: ws,
      kind: "calendar",
      profileId: second.profile.id,
      name: getPreset("calendar").name,
    });
    const calendarService = state.services.find((s) => s.kind === "calendar")!;
    state = reassignServiceGoogleProfile(state, calendarService.id, first.profile.id);
    expect(state.services.find((s) => s.id === calendarService.id)?.profileId).toBe(
      first.profile.id,
    );
    expect(googlePartitionForProfile(state, first.profile.id)).toBe(first.profile.partitionName);
  });

  it("rejeita reatribuir uma conta Google para um serviço que não usa sessão Google", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, { name: "A", color: "#1", crmProfileId: "c1" });
    const ws = state.workspaces[0]!.id;
    const ensured = ensureWorkspaceGoogleProfile(state, ws);
    state = ensured.state;

    // whatsapp never uses the shared Google session — reassigning it should be rejected
    const waProfile = createWhatsAppProfile("WhatsApp");
    state = createServiceInstance(
      { ...state, profiles: [...state.profiles, waProfile] },
      { workspaceId: ws, kind: "whatsapp", profileId: waProfile.id, name: "WhatsApp" },
    );
    const waService = state.services.find((s) => s.kind === "whatsapp")!;
    expect(() => reassignServiceGoogleProfile(state, waService.id, ensured.profile.id)).toThrow();
  });

  it("rejeita nome vazio e conta inexistente", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, { name: "A", color: "#1", crmProfileId: "c1" });
    const ws = state.workspaces[0]!.id;
    const added = addGoogleAccountService(state, { workspaceId: ws, kind: "gmail" });
    state = added.state;

    expect(() => renameGoogleProfile(state, added.profile.id, "   ")).toThrow();
    expect(() => renameGoogleProfile(state, "profile-inexistente", "Nova")).toThrow();
  });
});
