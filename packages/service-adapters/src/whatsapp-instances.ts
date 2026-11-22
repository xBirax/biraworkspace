import { randomUUID } from "node:crypto";
import type { AppStateV1, Profile, ServiceInstance } from "@adr/contracts";
import { parseAppState } from "@adr/app-state";
import { createPartitionName } from "@adr/partitions";
import { createServiceInstance } from "./presets.js";

export type WhatsAppBadge = {
  serviceId: string;
  unread: number;
  label?: string;
};

export function createWhatsAppProfile(name: string): Profile {
  const id = randomUUID();
  return {
    id,
    kind: "whatsapp",
    name: name.trim() || "WhatsApp",
    partitionName: createPartitionName("whatsapp", id),
    createdAt: new Date().toISOString(),
  };
}

export function addWhatsAppInstance(
  state: AppStateV1,
  input: { workspaceId: string; name: string },
): AppStateV1 {
  const profile = createWhatsAppProfile(input.name);
  const withProfile = parseAppState({
    ...state,
    profiles: [...state.profiles, profile],
  });
  return createServiceInstance(withProfile, {
    workspaceId: input.workspaceId,
    kind: "whatsapp",
    profileId: profile.id,
    name: input.name,
  });
}

export function renameWhatsAppInstance(
  state: AppStateV1,
  serviceId: string,
  name: string,
): AppStateV1 {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("nome obrigatório");
  const service = state.services.find((s) => s.id === serviceId && s.kind === "whatsapp");
  if (!service) throw new Error("WhatsApp inexistente");
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

export function listWhatsAppInstances(state: AppStateV1, workspaceId: string): ServiceInstance[] {
  return state.services.filter(
    (s) => s.workspaceId === workspaceId && s.kind === "whatsapp" && !s.deletedAt,
  );
}

export function softDeleteService(
  state: AppStateV1,
  serviceId: string,
  at = new Date().toISOString(),
): AppStateV1 {
  const service = state.services.find((s) => s.id === serviceId && !s.deletedAt);
  if (!service) throw new Error("serviço inexistente");
  return parseAppState({
    ...state,
    services: state.services.map((s) => (s.id === serviceId ? { ...s, deletedAt: at } : s)),
    workspaces: state.workspaces.map((w) =>
      w.id === service.workspaceId
        ? {
            ...w,
            serviceInstanceIds: w.serviceInstanceIds.filter((id) => id !== serviceId),
            updatedAt: at,
          }
        : w,
    ),
  });
}

/**
 * Desfaz o softDeleteService: o serviço volta para o workspace na posição em
 * que estava (ou no fim, se a lista mudou de tamanho). A partição nunca saiu do
 * disco, então cookies e login voltam junto.
 */
export function restoreDeletedService(
  state: AppStateV1,
  serviceId: string,
  index?: number,
  at = new Date().toISOString(),
): AppStateV1 {
  const service = state.services.find((s) => s.id === serviceId && s.deletedAt);
  if (!service) throw new Error("serviço não está excluído");
  const workspace = state.workspaces.find((w) => w.id === service.workspaceId && !w.deletedAt);
  if (!workspace) throw new Error("workspace do serviço não existe mais");
  return parseAppState({
    ...state,
    services: state.services.map((s) => {
      if (s.id !== serviceId) return s;
      const { deletedAt: _deleted, ...rest } = s;
      return rest;
    }),
    workspaces: state.workspaces.map((w) => {
      if (w.id !== workspace.id) return w;
      const ids = w.serviceInstanceIds.filter((id) => id !== serviceId);
      const position = index === undefined ? ids.length : Math.max(0, Math.min(index, ids.length));
      ids.splice(position, 0, serviceId);
      return { ...w, serviceInstanceIds: ids, updatedAt: at };
    }),
  });
}

export function partitionNamesForWhatsApps(
  state: AppStateV1,
  workspaceId: string,
): string[] {
  const instances = listWhatsAppInstances(state, workspaceId);
  const profileIds = new Set(instances.map((s) => s.profileId));
  return state.profiles
    .filter((p) => profileIds.has(p.id))
    .map((p) => p.partitionName);
}

export function assertWhatsAppPartitionsIsolated(partitionNames: string[]): void {
  const unique = new Set(partitionNames);
  if (unique.size !== partitionNames.length) {
    throw new Error("partições WhatsApp duplicadas");
  }
  for (const name of partitionNames) {
    if (!/^persist:wa-[a-z0-9-]{8,64}$/i.test(name)) {
      throw new Error(`partição WhatsApp inválida: ${name}`);
    }
  }
}

export function updateWhatsAppBadge(
  badges: WhatsAppBadge[],
  serviceId: string,
  unread: number,
  label?: string,
): WhatsAppBadge[] {
  const next = badges.filter((b) => b.serviceId !== serviceId);
  if (unread <= 0 && !label) return next;
  const badge: WhatsAppBadge = { serviceId, unread: Math.max(0, Math.floor(unread)) };
  if (label) badge.label = label;
  next.push(badge);
  return next;
}

export { unreadFromWhatsAppTitle } from "./whatsapp-badge.js";

