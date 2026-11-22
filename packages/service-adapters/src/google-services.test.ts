import { describe, expect, it } from "vitest";
import { createEmptyAppState } from "@adr/app-state";
import { createWorkspace } from "@adr/workspaces";
import {
  addGmailAndCalendar,
  assertGoogleIsolation,
  ensureWorkspaceGoogleProfile,
  externalGoogleOpenUrl,
  googlePartitionForWorkspace,
  isGoogleAuthDomain,
  migrateServicesToSharedGoogleProfile,
  resolveGoogleEmbedMode,
} from "../src/google-services.js";
import { createServiceInstance, getPreset } from "../src/presets.js";

describe("isGoogleAuthDomain", () => {
  it("matches Google and YouTube, cookie domains included", () => {
    for (const domain of [
      "google.com",
      ".google.com",
      "accounts.google.com",
      "mail.google.com",
      ".youtube.com",
      "www.gstatic.com",
    ]) {
      expect(isGoogleAuthDomain(domain)).toBe(true);
    }
  });

  it("leaves the services that share the partition alone", () => {
    // O motivo do filtro existir: sair do Google não pode derrubar o Spotify.
    for (const domain of [".spotify.com", "open.spotify.com", "i.scdn.co", "example.com", ""]) {
      expect(isGoogleAuthDomain(domain)).toBe(false);
    }
  });

  it("does not match a lookalike suffix", () => {
    expect(isGoogleAuthDomain("notgoogle.com")).toBe(false);
    expect(isGoogleAuthDomain("google.com.br")).toBe(false);
  });
});

describe("gmail/calendar workspace isolation", () => {
  it("shares Google profile inside a workspace and isolates across workspaces", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, { name: "A", color: "#1", crmProfileId: "c1" });
    state = createWorkspace(state, { name: "B", color: "#2", crmProfileId: "c2" });
    const [wsA, wsB] = state.workspaces.map((w) => w.id);

    state = addGmailAndCalendar(state, wsA!);
    state = addGmailAndCalendar(state, wsB!);

    const gmailA = state.services.filter((s) => s.workspaceId === wsA && s.kind === "gmail");
    const calA = state.services.filter((s) => s.workspaceId === wsA && s.kind === "calendar");
    expect(gmailA[0]?.profileId).toBe(calA[0]?.profileId);
    expect(googlePartitionForWorkspace(state, wsA!)).toMatch(/^persist:google-/);
    assertGoogleIsolation(state, wsA!, wsB!);
  });

  it("reuses Google SSO for YouTube and Spotify in the same workspace", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, { name: "A", color: "#1", crmProfileId: "c1" });
    const ws = state.workspaces[0]!.id;
    state = addGmailAndCalendar(state, ws);
    const ensured = ensureWorkspaceGoogleProfile(state, ws);
    state = ensured.state;
    state = createServiceInstance(state, {
      workspaceId: ws,
      kind: "youtube",
      profileId: ensured.profile.id,
      name: getPreset("youtube").name,
    });
    state = createServiceInstance(state, {
      workspaceId: ws,
      kind: "spotify",
      profileId: ensured.profile.id,
      name: getPreset("spotify").name,
    });
    const ids = state.services
      .filter((s) => s.workspaceId === ws && ["gmail", "youtube", "spotify"].includes(s.kind))
      .map((s) => s.profileId);
    expect(new Set(ids).size).toBe(1);
  });

  it("migrates older isolated browser profiles onto the shared Google jar", () => {
    let state = createEmptyAppState();
    state = createWorkspace(state, { name: "A", color: "#1", crmProfileId: "c1" });
    const ws = state.workspaces[0]!.id;
    state = addGmailAndCalendar(state, ws);
    const googleId = state.services.find((s) => s.kind === "gmail")!.profileId;
    const lone = {
      id: "yt-old",
      kind: "browser" as const,
      name: "old-yt",
      partitionName: "persist:browser-yt-old-000000000000",
      createdAt: new Date().toISOString(),
    };
    state = {
      ...state,
      profiles: [...state.profiles, lone],
      services: [
        ...state.services,
        {
          id: "svc-yt",
          workspaceId: ws,
          kind: "youtube",
          name: "YouTube",
          startUrl: "https://www.youtube.com/",
          profileId: lone.id,
          pinned: false,
          keepAwake: true,
        },
      ],
    };
    state = migrateServicesToSharedGoogleProfile(state);
    expect(state.services.find((s) => s.id === "svc-yt")?.profileId).toBe(googleId);
  });

  it("officializes external mode when embedded login is blocked", () => {
    expect(resolveGoogleEmbedMode(false)).toBe("external");
    expect(externalGoogleOpenUrl("gmail")).toContain("mail.google.com");
    expect(resolveGoogleEmbedMode(true)).toBe("embedded");
  });
});
