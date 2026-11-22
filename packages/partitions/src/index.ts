import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type PartitionKind = "whatsapp" | "google" | "browser" | "crm" | "instagram" | "microsoft";

const KIND_PREFIX: Record<PartitionKind, string> = {
  whatsapp: "wa",
  google: "google",
  browser: "browser",
  crm: "crm",
  instagram: "instagram",
  microsoft: "ms",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Partition names are created only in the main process — never accept renderer input. */
export function createPartitionName(kind: PartitionKind, id: string = randomUUID()): string {
  if (!/^[a-z0-9-]{8,64}$/i.test(id)) {
    throw new Error("profile id inválido para partição");
  }
  return `persist:${KIND_PREFIX[kind]}-${id}`;
}

export function assertSafePartitionName(name: string): void {
  if (!/^persist:(wa|google|browser|crm|instagram|ms)-[a-z0-9-]{8,64}$/i.test(name)) {
    throw new Error("nome de partição rejeitado");
  }
}

export function assertWorkspaceUuid(id: string): void {
  if (!UUID_RE.test(id)) throw new Error("workspace uuid inválido");
}

export function partitionStorageDirName(partitionName: string): string {
  assertSafePartitionName(partitionName);
  return partitionName.slice("persist:".length);
}

function assertInside(root: string, candidate: string): string {
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error("path escape rejeitado");
  }
  return resolved;
}

/** Resolve live Electron partition dir — never takes a free-form path from the renderer. */
export function livePartitionPath(userDataRoot: string, partitionName: string): string {
  const dir = partitionStorageDirName(partitionName);
  return assertInside(userDataRoot, path.join(userDataRoot, "Partitions", dir));
}

export function recoveryPartitionPath(
  userDataRoot: string,
  workspaceId: string,
  partitionName: string,
): string {
  assertWorkspaceUuid(workspaceId);
  const dir = partitionStorageDirName(partitionName);
  return assertInside(
    userDataRoot,
    path.join(userDataRoot, "recovery", workspaceId, dir),
  );
}

function moveDir(from: string, to: string): void {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to)) {
    // A previous recovery or a newly created live session may already be
    // there. Never erase either copy just to make the rename succeed.
    throw new Error(`destino da partição já existe: ${to}`);
  }
  fs.renameSync(from, to);
}

/** Move session dirs into recovery/<workspaceUuid>/ — keeps cookies for restore. */
export function quarantinePartitions(
  userDataRoot: string,
  workspaceId: string,
  partitionNames: string[],
): void {
  assertWorkspaceUuid(workspaceId);
  for (const name of partitionNames) {
    const from = livePartitionPath(userDataRoot, name);
    const to = recoveryPartitionPath(userDataRoot, workspaceId, name);
    moveDir(from, to);
  }
}

/** Move session dirs back from recovery — restore keeps the session. */
export function restoreQuarantinedPartitions(
  userDataRoot: string,
  workspaceId: string,
  partitionNames: string[],
): void {
  assertWorkspaceUuid(workspaceId);
  for (const name of partitionNames) {
    const from = recoveryPartitionPath(userDataRoot, workspaceId, name);
    const to = livePartitionPath(userDataRoot, name);
    moveDir(from, to);
  }
}

/**
 * Permanently delete recovery data for one workspace UUID only.
 * No globs; no renderer-supplied paths.
 */
export function purgeWorkspaceRecovery(userDataRoot: string, workspaceId: string): void {
  assertWorkspaceUuid(workspaceId);
  const target = assertInside(userDataRoot, path.join(userDataRoot, "recovery", workspaceId));
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

export class PartitionRegistry {
  #names = new Map<string, string>();

  allocate(profileId: string, kind: PartitionKind): string {
    const existing = this.#names.get(profileId);
    if (existing) return existing;
    const name = createPartitionName(kind, profileId);
    assertSafePartitionName(name);
    this.#names.set(profileId, name);
    return name;
  }

  get(profileId: string): string | undefined {
    return this.#names.get(profileId);
  }

  /** Reject any attempt to register a renderer-supplied partition string. */
  rejectExternalName(candidate: string): never {
    throw new Error(`partition name from renderer rejected: ${candidate.slice(0, 32)}`);
  }
}
