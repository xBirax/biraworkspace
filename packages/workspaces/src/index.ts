import { randomUUID } from "node:crypto";
import type { AppStateV1, Workspace } from "@adr/contracts";
import { createEmptyAppState, parseAppState } from "@adr/app-state";

/** Soft-deleted workspaces stay recoverable for 30 days. */
export const SOFT_DELETE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function now(): string {
  return new Date().toISOString();
}

function isDeleted(ws: Workspace): boolean {
  return Boolean(ws.deletedAt);
}

export function listActiveWorkspaces(state: AppStateV1): Workspace[] {
  return state.workspaces.filter((w) => !isDeleted(w));
}

export function createWorkspace(
  state: AppStateV1,
  input: { name: string; color: string; crmProfileId: string },
): AppStateV1 {
  const ws: Workspace = {
    id: randomUUID(),
    name: input.name.trim(),
    color: input.color,
    crmProfileId: input.crmProfileId,
    serviceInstanceIds: [],
    crmPosition: 0,
    createdAt: now(),
    updatedAt: now(),
  };
  if (!ws.name) throw new Error("nome obrigatório");
  const activeId = state.activeWorkspaceId;
  const activeStillValid =
    activeId && state.workspaces.some((w) => w.id === activeId && !isDeleted(w));
  return parseAppState({
    ...state,
    workspaces: [...state.workspaces, ws],
    activeWorkspaceId: activeStillValid ? activeId : ws.id,
  });
}

export function renameWorkspace(state: AppStateV1, id: string, name: string): AppStateV1 {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("nome obrigatório");
  if (!state.workspaces.some((workspace) => workspace.id === id && !workspace.deletedAt)) {
    throw new Error("workspace inexistente");
  }
  return parseAppState({
    ...state,
    workspaces: state.workspaces.map((w) =>
      w.id === id ? { ...w, name: trimmed, updatedAt: now() } : w,
    ),
  });
}

export function reorderWorkspaces(state: AppStateV1, orderedIds: string[]): AppStateV1 {
  const map = new Map(state.workspaces.map((w) => [w.id, w]));
  const next: Workspace[] = [];
  const seen = new Set<string>();
  for (const id of orderedIds) {
    const ws = map.get(id);
    if (ws && !seen.has(id)) {
      next.push(ws);
      seen.add(id);
    }
  }
  for (const ws of state.workspaces) {
    if (!seen.has(ws.id)) next.push(ws);
  }
  return parseAppState({ ...state, workspaces: next });
}

/** Reorder services inside one workspace (rail drag-and-drop). */
export function reorderWorkspaceServices(
  state: AppStateV1,
  workspaceId: string,
  orderedIds: string[],
): AppStateV1 {
  if (!state.workspaces.some((w) => w.id === workspaceId && !isDeleted(w))) {
    throw new Error("workspace inexistente");
  }
  const belonging = state.services
    .filter((s) => s.workspaceId === workspaceId && !s.deletedAt)
    .map((s) => s.id);
  const set = new Set(belonging);
  const nextIds: string[] = [];
  for (const id of orderedIds) {
    if (set.has(id) && !nextIds.includes(id)) nextIds.push(id);
  }
  for (const id of belonging) {
    if (!nextIds.includes(id)) nextIds.push(id);
  }
  return parseAppState({
    ...state,
    workspaces: state.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, serviceInstanceIds: nextIds, updatedAt: now() } : w,
    ),
  });
}

export function orderedServicesForWorkspace(state: AppStateV1, workspaceId: string) {
  const ws = state.workspaces.find((w) => w.id === workspaceId);
  const services = state.services.filter((s) => s.workspaceId === workspaceId && !s.deletedAt);
  const byId = new Map(services.map((s) => [s.id, s]));
  const ordered = [];
  for (const id of ws?.serviceInstanceIds || []) {
    const svc = byId.get(id);
    if (svc) {
      ordered.push(svc);
      byId.delete(id);
    }
  }
  for (const svc of byId.values()) ordered.push(svc);
  return ordered
    .map((service, index) => ({ service, index }))
    .sort((a, b) => Number(b.service.pinned) - Number(a.service.pinned) || a.index - b.index)
    .map(({ service }) => service);
}

/** Sentinel id for the CRM tile inside the unified sidebar rail order. */
export const CRM_RAIL_ID = "crm";

/**
 * Full sidebar rail order for one workspace: the ordered service tiles with
 * the CRM tile spliced in at `workspace.crmPosition`. This is what the
 * renderer should use to build the draggable icon list (services + CRM).
 */
export function railOrderForWorkspace(state: AppStateV1, workspaceId: string): string[] {
  const services = orderedServicesForWorkspace(state, workspaceId).map((s) => s.id);
  const ws = state.workspaces.find((w) => w.id === workspaceId);
  const pos = Math.max(0, Math.min(ws?.crmPosition ?? 0, services.length));
  return [...services.slice(0, pos), CRM_RAIL_ID, ...services.slice(pos)];
}

/**
 * Reorder the unified rail (services + CRM tile) inside one workspace.
 * Delegates the service-only ordering to reorderWorkspaceServices (which
 * already ignores unknown ids like CRM_RAIL_ID via its belonging check),
 * then derives workspace.crmPosition from where CRM_RAIL_ID landed relative
 * to the final service order.
 */
export function reorderWorkspaceRail(
  state: AppStateV1,
  workspaceId: string,
  orderedIds: string[],
): AppStateV1 {
  const next = reorderWorkspaceServices(state, workspaceId, orderedIds);
  const finalServiceOrder = orderedServicesForWorkspace(next, workspaceId).map((s) => s.id);
  const crmIndexInInput = orderedIds.indexOf(CRM_RAIL_ID);
  const idsBeforeCrm = crmIndexInInput < 0 ? orderedIds : orderedIds.slice(0, crmIndexInInput);
  const before = new Set(idsBeforeCrm);
  const crmPosition =
    crmIndexInInput < 0
      ? finalServiceOrder.length
      : finalServiceOrder.filter((id) => before.has(id)).length;
  return parseAppState({
    ...next,
    workspaces: next.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, crmPosition, updatedAt: now() } : w,
    ),
  });
}

export function setActiveWorkspace(state: AppStateV1, id: string): AppStateV1 {
  const ws = state.workspaces.find((w) => w.id === id);
  if (!ws || isDeleted(ws)) throw new Error("workspace inexistente");
  return parseAppState({ ...state, activeWorkspaceId: id });
}

/** Soft-delete workspace + its services. Session data must be quarantined by main. */
export function softDeleteWorkspace(state: AppStateV1, id: string, at: string = now()): AppStateV1 {
  if (!state.workspaces.some((w) => w.id === id)) throw new Error("workspace inexistente");
  const workspaces = state.workspaces.map((w) =>
    w.id === id ? { ...w, deletedAt: at, updatedAt: at } : w,
  );
  // Serviço já excluído antes guarda o carimbo dele: restaurar o workspace não o ressuscita.
  const services = state.services.map((s) =>
    s.workspaceId === id && !s.deletedAt ? { ...s, deletedAt: at } : s,
  );
  const active = listActiveWorkspaces({ ...state, workspaces });
  const nextActive = state.activeWorkspaceId === id ? active[0]?.id : state.activeWorkspaceId;
  const next = { ...state, workspaces, services } as AppStateV1;
  if (nextActive) {
    return parseAppState({ ...next, activeWorkspaceId: nextActive });
  }
  const { activeWorkspaceId: _removed, ...rest } = next;
  return parseAppState(rest);
}

/** @deprecated use softDeleteWorkspace — kept for R16 call sites */
export function archiveWorkspace(state: AppStateV1, id: string): AppStateV1 {
  return softDeleteWorkspace(state, id);
}

export function restoreWorkspace(state: AppStateV1, id: string): AppStateV1 {
  const ws = state.workspaces.find((w) => w.id === id);
  if (!ws?.deletedAt) throw new Error("workspace não está em soft-delete");
  const stamp = now();
  const workspaces = state.workspaces.map((w) => {
    if (w.id !== id) return w;
    const { deletedAt: _d, ...rest } = w;
    return { ...rest, updatedAt: stamp };
  });
  const services = state.services.map((s) => {
    if (s.workspaceId !== id || s.deletedAt !== ws.deletedAt) return s;
    const { deletedAt: _d, ...rest } = s;
    return rest;
  });
  return parseAppState({
    ...state,
    workspaces,
    services,
    activeWorkspaceId: state.activeWorkspaceId ?? id,
  });
}

export function workspacesDueForPurge(
  state: AppStateV1,
  nowMs: number = Date.now(),
  retentionMs: number = SOFT_DELETE_RETENTION_MS,
): string[] {
  return state.workspaces
    .filter((w) => w.deletedAt && nowMs - Date.parse(w.deletedAt) >= retentionMs)
    .map((w) => w.id);
}

/** Hard-remove one soft-deleted workspace by UUID. Partition purge is separate. */
export function purgeWorkspace(state: AppStateV1, id: string): AppStateV1 {
  const ws = state.workspaces.find((w) => w.id === id);
  if (!ws) throw new Error("workspace inexistente");
  if (!ws.deletedAt) throw new Error("purge só após soft-delete");
  const workspaces = state.workspaces.filter((w) => w.id !== id);
  const services = state.services.filter((s) => s.workspaceId !== id);
  // Serviço estacionado (tipo de versão mais nova) também segura o perfil dele:
  // sem isto, a versão nova que o reativasse acharia o perfil apagado e cairia
  // numa partição vazia (deslogado). Os do workspace apagado saem junto.
  const parkedServices = state.parkedServices.filter((s) => s["workspaceId"] !== id);
  const profileIdsInUse = new Set<unknown>([
    ...workspaces.map((w) => w.crmProfileId),
    ...services.map((s) => s.profileId),
    ...parkedServices.map((s) => s["profileId"]),
  ]);
  const profiles = state.profiles.filter((p) => profileIdsInUse.has(p.id));
  const parkedProfiles = state.parkedProfiles.filter((p) => profileIdsInUse.has(p["id"]));
  const next = { ...state, workspaces, services, profiles, parkedServices, parkedProfiles } as AppStateV1;
  if (state.activeWorkspaceId === id) {
    const { activeWorkspaceId: _a, ...rest } = next;
    const fallback = listActiveWorkspaces(next)[0]?.id;
    return fallback ? parseAppState({ ...rest, activeWorkspaceId: fallback }) : parseAppState(rest);
  }
  return parseAppState(next);
}

export function purgeExpiredWorkspaces(
  state: AppStateV1,
  nowMs: number = Date.now(),
): { state: AppStateV1; purgedIds: string[] } {
  const ids = workspacesDueForPurge(state, nowMs);
  let next = state;
  for (const id of ids) {
    next = purgeWorkspace(next, id);
  }
  return { state: next, purgedIds: ids };
}

export function restoreWorkspacesFromSnapshots(snapshots: AppStateV1[]): AppStateV1 {
  if (!snapshots.length) return createEmptyAppState();
  return parseAppState(snapshots[snapshots.length - 1]);
}
