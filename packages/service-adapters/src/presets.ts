import type { ServiceKind, ServiceInstance, AppStateV1, Profile } from "@adr/contracts";
import { parseAppState } from "@adr/app-state";
import { createPartitionName } from "@adr/partitions";
import { randomUUID } from "node:crypto";

export type ServicePreset = {
  kind: ServiceKind;
  name: string;
  startUrl: string;
  profileKind: "whatsapp" | "google" | "browser" | "crm" | "instagram" | "microsoft";
};

export const SERVICE_PRESETS: readonly ServicePreset[] = [
  {
    kind: "whatsapp",
    name: "WhatsApp",
    startUrl: "https://web.whatsapp.com/",
    profileKind: "whatsapp",
  },
  {
    kind: "gmail",
    name: "Gmail",
    startUrl: "https://mail.google.com/",
    profileKind: "google",
  },
  {
    kind: "calendar",
    name: "Calendar",
    startUrl: "https://calendar.google.com/",
    profileKind: "google",
  },
  {
    kind: "drive",
    name: "Drive",
    startUrl: "https://drive.google.com/",
    profileKind: "google",
  },
  {
    kind: "notion",
    name: "Notion",
    startUrl: "https://www.notion.so/",
    profileKind: "browser",
  },
  {
    kind: "trello",
    name: "Trello",
    startUrl: "https://trello.com/",
    profileKind: "browser",
  },
  {
    kind: "chatgpt",
    name: "ChatGPT",
    startUrl: "https://chatgpt.com/",
    profileKind: "browser",
  },
  {
    kind: "claude",
    name: "Claude",
    startUrl: "https://claude.ai/",
    profileKind: "browser",
  },
  {
    kind: "gemini",
    name: "Gemini",
    startUrl: "https://gemini.google.com/app",
    profileKind: "google",
  },
  {
    kind: "meet",
    name: "Google Meet",
    startUrl: "https://meet.google.com/",
    profileKind: "google",
  },
  {
    kind: "youtube",
    name: "YouTube",
    startUrl: "https://www.youtube.com/",
    profileKind: "google",
  },
  {
    kind: "spotify",
    name: "Spotify",
    startUrl: "https://open.spotify.com/",
    profileKind: "google",
  },
  {
    kind: "browser",
    name: "ADR Browser",
    startUrl: "https://www.google.com/",
    profileKind: "google",
  },
  {
    kind: "instagram",
    name: "Instagram",
    startUrl: "https://www.instagram.com/",
    profileKind: "instagram",
  },
  {
    kind: "tiktok",
    name: "TikTok",
    startUrl: "https://www.tiktok.com/",
    profileKind: "browser",
  },
  {
    kind: "outlook",
    name: "Outlook",
    startUrl: "https://outlook.office.com/mail/",
    profileKind: "microsoft",
  },
  {
    kind: "teams",
    name: "Teams",
    startUrl: "https://teams.microsoft.com/",
    profileKind: "microsoft",
  },
] as const;

/**
 * Serviços com login próprio: cada conta é uma partição nova, sem a sessão
 * Google do workspace (ver addStandaloneService). Uma lista só — antes ela se
 * repetia em sete lugares e já divergia (Notion duplicava na mesma conta).
 */
export const STANDALONE_LOGIN_KINDS = ["notion", "trello", "chatgpt", "claude", "tiktok"] as const satisfies readonly ServiceKind[];

export function usesStandaloneLogin(kind: string): boolean {
  return (STANDALONE_LOGIN_KINDS as readonly string[]).includes(kind);
}

/** Sessão própria por conta: duplicar abre OUTRA conta, e o nome é do usuário. */
export function ownsSession(kind: string): boolean {
  return kind === "whatsapp" || kind === "instagram" || usesStandaloneLogin(kind);
}

export function getPreset(kind: ServiceKind): ServicePreset {
  const preset = SERVICE_PRESETS.find((p) => p.kind === kind);
  if (!preset) throw new Error(`preset ausente: ${kind}`);
  return preset;
}

export function createServiceInstance(
  state: AppStateV1,
  input: {
    workspaceId: string;
    kind: ServiceKind;
    profileId: string;
    name?: string;
    startUrl?: string;
    pinned?: boolean;
    keepAwake?: boolean;
    hibernateAfterMinutes?: number | undefined;
  },
): AppStateV1 {
  if (!state.workspaces.some((w) => w.id === input.workspaceId && !w.deletedAt)) {
    throw new Error("workspace inexistente");
  }
  const preset = getPreset(input.kind);
  const service: ServiceInstance = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    kind: input.kind,
    name: (input.name || preset.name).trim(),
    startUrl: input.startUrl || preset.startUrl,
    profileId: input.profileId,
    pinned: input.pinned ?? false,
    keepAwake: input.keepAwake ?? (input.kind === "whatsapp" || input.kind === "gmail"),
    ...(input.hibernateAfterMinutes !== undefined ? { hibernateAfterMinutes: input.hibernateAfterMinutes } : {}),
  };
  return parseAppState({
    ...state,
    services: [...state.services, service],
    workspaces: state.workspaces.map((w) =>
      w.id === input.workspaceId
        ? {
            ...w,
            serviceInstanceIds: [...w.serviceInstanceIds, service.id],
            updatedAt: new Date().toISOString(),
          }
        : w,
    ),
  });
}

/**
 * Serviço com login próprio: perfil e partição novos, sem a sessão Google do
 * workspace. WhatsApp e Instagram têm helpers dedicados; este atende Notion
 * Trello, ChatGPT, Claude e TikTok, inclusive quando há várias contas isoladas no mesmo workspace.
 */
export function addStandaloneService(
  state: AppStateV1,
  input: { workspaceId: string; kind: ServiceKind; name?: string },
): AppStateV1 {
  const preset = getPreset(input.kind);
  const id = randomUUID();
  const profile: Profile = {
    id,
    kind: preset.profileKind,
    name: input.name?.trim() || preset.name,
    partitionName: createPartitionName(preset.profileKind, id),
    createdAt: new Date().toISOString(),
  };
  const withProfile = parseAppState({ ...state, profiles: [...state.profiles, profile] });
  return createServiceInstance(withProfile, {
    workspaceId: input.workspaceId,
    kind: input.kind,
    profileId: profile.id,
    name: input.name?.trim() || preset.name,
  });
}

export function expectedAdapterFor(kind: ServiceKind): string {
  switch (kind) {
    case "whatsapp":
      return "whatsapp-adapter";
    case "gmail":
    case "calendar":
    case "drive":
    case "gemini":
    case "meet":
      return "google-adapter";
    case "youtube":
      return "youtube-adapter";
    case "spotify":
      return "spotify-adapter";
    case "browser":
    case "notion":
    case "trello":
    case "chatgpt":
    case "claude":
    case "tiktok":
      return "browser-adapter";
    case "instagram":
      return "instagram-adapter";
    case "outlook":
    case "teams":
      return "microsoft-adapter";
  }
}
