import { randomUUID } from "node:crypto";
import type { AppStateV1, Profile, ServiceInstance } from "@adr/contracts";
import { parseAppState } from "@adr/app-state";
import { createPartitionName } from "@adr/partitions";
import { createServiceInstance } from "./presets.js";

/**
 * Instagram accounts, like WhatsApp numbers, each need their own isolated
 * login session — unlike Gmail/Calendar/YouTube/Spotify, which share one
 * Google profile per workspace. This mirrors whatsapp-instances.ts so users
 * can add multiple Instagram accounts, each on its own partition.
 */
export function createInstagramProfile(name: string): Profile {
  const id = randomUUID();
  return {
    id,
    kind: "instagram",
    name: name.trim() || "Instagram",
    partitionName: createPartitionName("instagram", id),
    createdAt: new Date().toISOString(),
  };
}

export function addInstagramInstance(
  state: AppStateV1,
  input: { workspaceId: string; name: string },
): AppStateV1 {
  const profile = createInstagramProfile(input.name);
  const withProfile = parseAppState({
    ...state,
    profiles: [...state.profiles, profile],
  });
  return createServiceInstance(withProfile, {
    workspaceId: input.workspaceId,
    kind: "instagram",
    profileId: profile.id,
    name: input.name,
  });
}

export function renameInstagramInstance(
  state: AppStateV1,
  serviceId: string,
  name: string,
): AppStateV1 {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("nome obrigatório");
  const service = state.services.find((s) => s.id === serviceId && s.kind === "instagram");
  if (!service) throw new Error("Instagram inexistente");
  return parseAppState({
    ...state,
    services: state.services.map((s) =>
      s.id === serviceId ? { ...s, name: trimmed } : s,
    ),
    profiles: state.profiles.map((p) =>
      p.id === service.profileId ? { ...p, name: trimmed } : p,
    ),
  });
}

export function listInstagramInstances(state: AppStateV1, workspaceId: string): ServiceInstance[] {
  return state.services.filter(
    (s) => s.workspaceId === workspaceId && s.kind === "instagram" && !s.deletedAt,
  );
}

export function partitionNamesForInstagrams(
  state: AppStateV1,
  workspaceId: string,
): string[] {
  const instances = listInstagramInstances(state, workspaceId);
  const profileIds = new Set(instances.map((s) => s.profileId));
  return state.profiles
    .filter((p) => profileIds.has(p.id))
    .map((p) => p.partitionName);
}

export function assertInstagramPartitionsIsolated(partitionNames: string[]): void {
  const unique = new Set(partitionNames);
  if (unique.size !== partitionNames.length) {
    throw new Error("partições Instagram duplicadas");
  }
  for (const name of partitionNames) {
    if (!/^persist:instagram-[a-z0-9-]{8,64}$/i.test(name)) {
      throw new Error(`partição Instagram inválida: ${name}`);
    }
  }
}
