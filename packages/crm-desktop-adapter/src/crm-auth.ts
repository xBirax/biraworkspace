import { createPartitionName } from "@adr/partitions";

const WORKSPACE_ID_RE = /^[a-z0-9-]{1,64}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** CRM partition for a workspace — never accept a renderer-supplied partition string. */
export function crmPartitionForWorkspace(workspaceId: string): string {
  if (!WORKSPACE_ID_RE.test(workspaceId)) {
    throw new Error("workspace id inválido para partição CRM");
  }
  if (UUID_RE.test(workspaceId)) {
    return createPartitionName("crm", workspaceId);
  }
  // Slug ids (incl. legacy "default") stay on the crm- prefix namespace.
  return `persist:crm-${workspaceId}`;
}

export type CookieRecord = { name: string; value: string; url: string };

export type CookieStore = {
  get(filter: { url: string; name?: string }): Promise<CookieRecord[]>;
  set(cookie: CookieRecord): Promise<void>;
  remove(url: string, name: string): Promise<void>;
};

export type AuthCookies = {
  auth_token: string;
  tenant_id: string;
};

export async function readCrmAuthCookies(
  store: CookieStore,
  baseUrl: string,
): Promise<Partial<AuthCookies>> {
  const [token, tenant] = await Promise.all([
    store.get({ url: baseUrl, name: "auth_token" }),
    store.get({ url: baseUrl, name: "tenant_id" }),
  ]);
  const out: Partial<AuthCookies> = {};
  if (token[0]?.value) out.auth_token = token[0].value;
  if (tenant[0]?.value) out.tenant_id = tenant[0].value;
  return out;
}

export async function writeCrmAuthCookies(
  store: CookieStore,
  baseUrl: string,
  auth: AuthCookies,
): Promise<void> {
  await store.set({ url: baseUrl, name: "auth_token", value: auth.auth_token });
  await store.set({ url: baseUrl, name: "tenant_id", value: auth.tenant_id });
}

/** Logout clears only the provided store (one workspace partition). */
export async function logoutCrmSession(store: CookieStore, baseUrl: string): Promise<void> {
  await store.remove(baseUrl, "auth_token");
  await store.remove(baseUrl, "tenant_id");
  await store.remove(baseUrl, "impersonate_user_id");
  await store.remove(baseUrl, "adr_impersonation_session");
}

/** In-memory cookie jar for isolation tests (one jar === one partition). */
export class MemoryCookieStore implements CookieStore {
  #jar = new Map<string, string>();

  #key(url: string, name: string): string {
    return `${url}::${name}`;
  }

  async get(filter: { url: string; name?: string }): Promise<CookieRecord[]> {
    if (filter.name) {
      const value = this.#jar.get(this.#key(filter.url, filter.name));
      return value ? [{ url: filter.url, name: filter.name, value }] : [];
    }
    const out: CookieRecord[] = [];
    for (const [key, value] of this.#jar) {
      if (!key.startsWith(`${filter.url}::`)) continue;
      out.push({ url: filter.url, name: key.slice(filter.url.length + 2), value });
    }
    return out;
  }

  async set(cookie: CookieRecord): Promise<void> {
    this.#jar.set(this.#key(cookie.url, cookie.name), cookie.value);
  }

  async remove(url: string, name: string): Promise<void> {
    this.#jar.delete(this.#key(url, name));
  }
}
