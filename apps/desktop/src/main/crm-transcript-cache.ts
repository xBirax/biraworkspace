import { writeCachedTranscript } from "@adr/crm-core";

type SessionIdentity = { hasCrm: boolean; scope?: string };
type Items = ReturnType<typeof writeCachedTranscript>;

function denied(): Error {
  return Object.assign(new Error("Contexto de sessão inválido. Faça login novamente no CRM."), {
    code: "FORBIDDEN",
    status: 403,
  });
}

/** Renderer scope is an assertion, never an authority or a global cache key. */
export class CrmTranscriptCache {
  private workspaces = new Map<string, { scope: string; items: Items }>();
  private revisions = new Map<string, number>();

  constructor(private readonly authorize: (workspaceId: string) => Promise<SessionIdentity>) {}

  invalidate(workspaceId: string): void {
    this.workspaces.delete(workspaceId);
    this.revisions.set(workspaceId, (this.revisions.get(workspaceId) || 0) + 1);
  }

  private async authorizedEntry(workspaceId: string, requestedScope: string) {
    const revision = this.revisions.get(workspaceId) || 0;
    let identity: SessionIdentity;
    try {
      // Always validate with the CRM before returning even an existing cache hit.
      identity = await this.authorize(workspaceId);
    } catch (error) {
      this.invalidate(workspaceId);
      throw error;
    }
    if (revision !== (this.revisions.get(workspaceId) || 0)) throw denied();
    if (!identity.hasCrm || !identity.scope) {
      this.invalidate(workspaceId);
      throw denied();
    }
    let entry = this.workspaces.get(workspaceId);
    if (entry?.scope !== identity.scope) {
      this.workspaces.delete(workspaceId);
      entry = undefined;
    }
    if (requestedScope !== identity.scope) throw denied();
    if (!entry) {
      entry = { scope: identity.scope, items: {} };
      this.workspaces.set(workspaceId, entry);
    }
    return entry;
  }

  async read(workspaceId: string, scope: string): Promise<{ items: Items }> {
    const entry = await this.authorizedEntry(workspaceId, scope);
    if (this.workspaces.get(workspaceId) !== entry) throw denied();
    entry.items = writeCachedTranscript(entry.items, "", "");
    return { items: entry.items };
  }

  async write(workspaceId: string, scope: string, externalId: string, text: string) {
    const entry = await this.authorizedEntry(workspaceId, scope);
    if (this.workspaces.get(workspaceId) !== entry) throw denied();
    entry.items = writeCachedTranscript(entry.items, externalId, text);
    return { saved: Object.hasOwn(entry.items, externalId) };
  }
}
