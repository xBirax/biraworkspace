import { randomUUID } from "node:crypto";
import type { AppStateV1, Profile, ServiceKind } from "@adr/contracts";
import { parseAppState } from "@adr/app-state";
import { createPartitionName } from "@adr/partitions";
import { createServiceInstance, getPreset } from "./presets.js";

/**
 * Outlook e Teams de uma conta Microsoft dividem a sessão — um login vale para
 * os dois —, como Gmail e Agenda numa conta Google. Outra conta Microsoft é
 * outro perfil, com partição própria.
 */
export const MICROSOFT_SESSION_KINDS = ["outlook", "teams"] as const satisfies readonly ServiceKind[];

export type MicrosoftSessionKind = (typeof MICROSOFT_SESSION_KINDS)[number];

export function usesSharedMicrosoftSession(kind: string): kind is MicrosoftSessionKind {
  return (MICROSOFT_SESSION_KINDS as readonly string[]).includes(kind);
}

/** Contas Microsoft usadas por serviços (não excluídos) do workspace. */
export function listMicrosoftProfilesForWorkspace(state: AppStateV1, workspaceId: string): Profile[] {
  const ids = new Set(
    state.services
      .filter((s) => s.workspaceId === workspaceId && !s.deletedAt && usesSharedMicrosoftSession(s.kind))
      .map((s) => s.profileId),
  );
  return state.profiles.filter((p) => p.kind === "microsoft" && ids.has(p.id));
}

/**
 * Outlook/Teams na conta Microsoft do workspace (a primeira) ou, com
 * `newAccount`, numa conta nova, que entra com login do zero.
 */
export function addMicrosoftService(
  state: AppStateV1,
  input: { workspaceId: string; kind: MicrosoftSessionKind; name?: string; newAccount?: boolean },
): AppStateV1 {
  if (!state.workspaces.some((w) => w.id === input.workspaceId && !w.deletedAt)) {
    throw new Error("workspace inexistente");
  }
  const accounts = listMicrosoftProfilesForWorkspace(state, input.workspaceId);
  // Sem conta em uso, a do último Outlook/Teams removido ainda está logada (a
  // sessão fica 30 dias): reusar evita pedir login de novo e deixar a antiga órfã.
  const removed = state.services
    .filter((s) => s.workspaceId === input.workspaceId && s.deletedAt && usesSharedMicrosoftSession(s.kind))
    .sort((a, b) => (b.deletedAt! < a.deletedAt! ? -1 : 1));
  // O mesmo tipo primeiro: o Outlook removido sabe a conta do Outlook.
  const reused =
    accounts.length || input.newAccount ? undefined : (removed.find((s) => s.kind === input.kind) ?? removed[0]);
  let profile = input.newAccount
    ? undefined
    : (accounts[0] ?? state.profiles.find((p) => p.id === reused?.profileId && p.kind === "microsoft"));
  // O mesmo serviço removido dessa conta já sabia onde ela mora (outlook.live.com).
  const startUrl = removed.find((s) => s.kind === input.kind && s.profileId === profile?.id)?.startUrl;
  if (
    !input.newAccount &&
    state.services.some((s) => s.workspaceId === input.workspaceId && s.kind === input.kind && !s.deletedAt)
  ) {
    throw new Error(`${input.kind} já adicionado neste workspace`);
  }
  let next = state;
  if (!profile) {
    // Nome livre entre as contas do workspace, inclusive as de serviços
    // removidos: contar só as em uso repetia "Microsoft 2" depois de remover uma.
    const inWorkspace = new Set(
      state.services.filter((s) => s.workspaceId === input.workspaceId).map((s) => s.profileId),
    );
    const taken = new Set(
      state.profiles.filter((p) => p.kind === "microsoft" && inWorkspace.has(p.id)).map((p) => p.name),
    );
    let name = "Microsoft";
    for (let n = 2; taken.has(name); n++) name = `Microsoft ${n}`;
    const id = randomUUID();
    profile = {
      id,
      kind: "microsoft",
      name,
      partitionName: createPartitionName("microsoft", id),
      createdAt: new Date().toISOString(),
    };
    next = parseAppState({ ...state, profiles: [...state.profiles, profile] });
  }
  return createServiceInstance(next, {
    workspaceId: input.workspaceId,
    kind: input.kind,
    profileId: profile.id,
    name: input.name?.trim() || getPreset(input.kind).name,
    ...(startUrl ? { startUrl } : {}),
  });
}

export function renameMicrosoftProfile(state: AppStateV1, profileId: string, name: string): AppStateV1 {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("nome obrigatório");
  if (!state.profiles.some((p) => p.id === profileId && p.kind === "microsoft")) {
    throw new Error("conta Microsoft inexistente");
  }
  return parseAppState({
    ...state,
    profiles: state.profiles.map((p) => (p.id === profileId ? { ...p, name: trimmed } : p)),
  });
}

/** Aponta Outlook/Teams para outra conta Microsoft já logada no workspace. */
export function reassignServiceMicrosoftProfile(
  state: AppStateV1,
  serviceId: string,
  profileId: string,
): AppStateV1 {
  const service = state.services.find((s) => s.id === serviceId && !s.deletedAt);
  if (!service) throw new Error("serviço inexistente");
  if (!usesSharedMicrosoftSession(service.kind)) throw new Error(`${service.kind} não usa conta Microsoft`);
  if (!listMicrosoftProfilesForWorkspace(state, service.workspaceId).some((p) => p.id === profileId)) {
    throw new Error("conta Microsoft não pertence a este workspace");
  }
  // A casa lembrada (outlook.live.com x outlook.office.com) era da conta anterior.
  return parseAppState({
    ...state,
    services: state.services.map((s) =>
      s.id === serviceId ? { ...s, profileId, startUrl: getPreset(s.kind).startUrl } : s,
    ),
  });
}
