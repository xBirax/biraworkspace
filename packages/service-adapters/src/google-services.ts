import { randomUUID } from "node:crypto";
import type { AppStateV1, Profile, ServiceKind } from "@adr/contracts";
import { parseAppState } from "@adr/app-state";
import { createPartitionName } from "@adr/partitions";
import { createServiceInstance, getPreset } from "./presets.js";

export type GoogleEmbedMode = "embedded" | "external";

/** Services that share one Google cookie jar per workspace (SSO). */
export const GOOGLE_SESSION_KINDS = [
  "gmail",
  "calendar",
  "drive",
  "gemini",
  "meet",
  "youtube",
  "spotify",
  "browser",
] as const satisfies readonly ServiceKind[];

export type GoogleSessionKind = (typeof GOOGLE_SESSION_KINDS)[number];

export function usesSharedGoogleSession(kind: ServiceKind): kind is GoogleSessionKind {
  return (GOOGLE_SESSION_KINDS as readonly string[]).includes(kind);
}

/**
 * Domínios que o "sair da conta Google" pode limpar. A partição é compartilhada
 * com Spotify e ADR Browser: limpá-la inteira derrubava o login do Spotify e o
 * histórico do navegador de quem só queria trocar de conta Google.
 */
const GOOGLE_AUTH_SUFFIXES = [
  "google.com",
  "googleapis.com",
  "googleusercontent.com",
  "gstatic.com",
  "youtube.com",
  "youtu.be",
  "ytimg.com",
];

/** Aceita host ou domínio de cookie (que vem com ponto na frente). */
export function isGoogleAuthDomain(hostOrCookieDomain: string): boolean {
  const host = String(hostOrCookieDomain || "").toLowerCase().replace(/^\.+/, "").replace(/\.$/, "");
  if (!host) return false;
  return GOOGLE_AUTH_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** Origens a limpar em clearStorageData — localStorage/IndexedDB/service worker. */
export const GOOGLE_AUTH_ORIGINS = [
  "https://accounts.google.com",
  "https://google.com",
  "https://www.google.com",
  "https://mail.google.com",
  "https://calendar.google.com",
  "https://contacts.google.com",
  "https://drive.google.com",
  "https://gemini.google.com",
  "https://meet.google.com",
  "https://www.youtube.com",
  "https://youtube.com",
];

function findWorkspaceGoogleProfile(state: AppStateV1, workspaceId: string): Profile | undefined {
  return state.profiles.find(
    (p) =>
      p.kind === "google" &&
      state.services.some(
        (s) =>
          s.workspaceId === workspaceId &&
          s.profileId === p.id &&
          usesSharedGoogleSession(s.kind) &&
          !s.deletedAt,
      ),
  );
}

/** Shared Google profile per workspace (Gmail, Calendar, YouTube, Spotify OAuth, Browser). */
export function ensureWorkspaceGoogleProfile(
  state: AppStateV1,
  workspaceId: string,
  name = "Google",
): { state: AppStateV1; profile: Profile } {
  const existing = findWorkspaceGoogleProfile(state, workspaceId);
  if (existing) return { state, profile: existing };

  const id = randomUUID();
  const profile: Profile = {
    id,
    kind: "google",
    name,
    partitionName: createPartitionName("google", id),
    createdAt: new Date().toISOString(),
  };
  return {
    state: parseAppState({ ...state, profiles: [...state.profiles, profile] }),
    profile,
  };
}

export function addGmailAndCalendar(
  state: AppStateV1,
  workspaceId: string,
): AppStateV1 {
  const ensured = ensureWorkspaceGoogleProfile(state, workspaceId);
  let next = ensured.state;
  next = createServiceInstance(next, {
    workspaceId,
    kind: "gmail",
    profileId: ensured.profile.id,
    name: getPreset("gmail").name,
  });
  next = createServiceInstance(next, {
    workspaceId,
    kind: "calendar",
    profileId: ensured.profile.id,
    name: getPreset("calendar").name,
  });
  return next;
}

/**
 * Point Google-family services that still have a LEGACY profile (one that is not
 * a `kind: "google"` profile) at the workspace Google jar.
 *
 * Roda a cada boot, então só pode tocar em quem ainda não tem conta Google
 * própria: reescrever todos os serviços para um único profileId desfazia, de
 * forma silenciosa e a cada abertura do app, qualquer segunda conta criada.
 */
export function migrateServicesToSharedGoogleProfile(state: AppStateV1): AppStateV1 {
  let next = state;
  for (const ws of next.workspaces) {
    if (ws.deletedAt) continue;
    const googleProfileIds = new Set(
      next.profiles.filter((p) => p.kind === "google").map((p) => p.id),
    );
    const legacy = next.services.filter(
      (s) =>
        s.workspaceId === ws.id &&
        !s.deletedAt &&
        usesSharedGoogleSession(s.kind) &&
        !googleProfileIds.has(s.profileId),
    );
    if (!legacy.length) continue;
    const ensured = ensureWorkspaceGoogleProfile(next, ws.id);
    next = ensured.state;
    const profileId = ensured.profile.id;
    const legacyIds = new Set(legacy.map((s) => s.id));
    next = parseAppState({
      ...next,
      services: next.services.map((s) => (legacyIds.has(s.id) ? { ...s, profileId } : s)),
    });
  }
  return next;
}

export function googlePartitionForWorkspace(
  state: AppStateV1,
  workspaceId: string,
): string | undefined {
  const service = state.services.find(
    (s) =>
      s.workspaceId === workspaceId &&
      usesSharedGoogleSession(s.kind) &&
      !s.deletedAt,
  );
  if (!service) return undefined;
  return state.profiles.find((p) => p.id === service.profileId)?.partitionName;
}

export function assertGoogleIsolation(state: AppStateV1, workspaceA: string, workspaceB: string): void {
  const a = googlePartitionForWorkspace(state, workspaceA);
  const b = googlePartitionForWorkspace(state, workspaceB);
  if (!a || !b) throw new Error("perfis Google ausentes");
  if (a === b) throw new Error("Google não isolado entre workspaces");
}

/** Create a standalone, unattached Google profile (its own cookie jar / partition). */
export function createGoogleProfile(name = "Google"): Profile {
  const id = randomUUID();
  return {
    id,
    kind: "google",
    name: name.trim() || "Google",
    partitionName: createPartitionName("google", id),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Add a Google-family service backed by a BRAND NEW, isolated Google profile — i.e. a
 * second (third, ...) named Google account inside this workspace. Each account signs in
 * fresh, in its own clean partition, instead of going through Google's "usar outra conta"
 * chooser inside an already-authenticated session — that in-session account-switch flow is
 * what Google's anti-abuse heuristics block hardest for embedded browsers (see
 * docs/runbooks + chrome-session.ts). A first-time sign-in in a brand-new profile is much
 * closer to what Google expects and is far less likely to be rejected.
 */
export function addGoogleAccountService(
  state: AppStateV1,
  input: { workspaceId: string; kind: GoogleSessionKind; name?: string; keepAwake?: boolean },
): { state: AppStateV1; profile: Profile } {
  if (!state.workspaces.some((w) => w.id === input.workspaceId && !w.deletedAt)) {
    throw new Error("workspace inexistente");
  }
  const profile = createGoogleProfile(input.name || getPreset(input.kind).name);
  const withProfile = parseAppState({ ...state, profiles: [...state.profiles, profile] });
  const next = createServiceInstance(withProfile, {
    workspaceId: input.workspaceId,
    kind: input.kind,
    profileId: profile.id,
    name: input.name?.trim() || getPreset(input.kind).name,
    keepAwake: input.keepAwake ?? false,
  });
  return { state: next, profile };
}

/** All Google profiles actually in use by (non-deleted) services in one workspace. */
export function listGoogleProfilesForWorkspace(state: AppStateV1, workspaceId: string): Profile[] {
  const ids = new Set(
    state.services
      .filter(
        (s) => s.workspaceId === workspaceId && !s.deletedAt && usesSharedGoogleSession(s.kind),
      )
      .map((s) => s.profileId),
  );
  return state.profiles.filter((p) => p.kind === "google" && ids.has(p.id));
}

export function renameGoogleProfile(state: AppStateV1, profileId: string, name: string): AppStateV1 {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("nome obrigatório");
  if (!state.profiles.some((p) => p.id === profileId && p.kind === "google")) {
    throw new Error("conta Google inexistente");
  }
  return parseAppState({
    ...state,
    profiles: state.profiles.map((p) => (p.id === profileId ? { ...p, name: trimmed } : p)),
  });
}

/**
 * Point an existing Google-family service at a DIFFERENT, already-existing Google profile —
 * e.g. reuse the same signed-in account across YouTube and Gmail without re-authenticating.
 */
export function reassignServiceGoogleProfile(
  state: AppStateV1,
  serviceId: string,
  profileId: string,
): AppStateV1 {
  const service = state.services.find((s) => s.id === serviceId && !s.deletedAt);
  if (!service) throw new Error("serviço inexistente");
  if (!usesSharedGoogleSession(service.kind)) {
    throw new Error(`${service.kind} não usa sessão Google`);
  }
  if (!listGoogleProfilesForWorkspace(state, service.workspaceId).some((p) => p.id === profileId)) {
    throw new Error("conta Google não pertence a este workspace");
  }
  return parseAppState({
    ...state,
    services: state.services.map((s) => (s.id === serviceId ? { ...s, profileId } : s)),
  });
}

export function googlePartitionForProfile(state: AppStateV1, profileId: string): string | undefined {
  return state.profiles.find((p) => p.id === profileId && p.kind === "google")?.partitionName;
}

/** Official fallback when embedded Google OAuth is blocked (R11/R32). */
export function resolveGoogleEmbedMode(canEmbedLogin: boolean): GoogleEmbedMode {
  return canEmbedLogin ? "embedded" : "external";
}

export function externalGoogleOpenUrl(kind: "gmail" | "calendar"): string {
  return getPreset(kind).startUrl;
}
