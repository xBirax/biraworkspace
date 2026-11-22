import type { Session } from "electron";
import {
  crmPartitionForWorkspace,
  logoutCrmSession,
  type CookieStore,
} from "@adr/crm-desktop-adapter";

/** Adapt Electron session cookies to the shared CookieStore shape. */
export function electronCookieStore(ses: Session): CookieStore {
  return {
    async get(filter) {
      const list = await ses.cookies.get(filter);
      return list.map((c) => ({
        name: c.name,
        value: c.value,
        url: filter.url,
      }));
    },
    async set(cookie) {
      await ses.cookies.set({
        url: cookie.url,
        name: cookie.name,
        value: cookie.value,
      });
    },
    async remove(url, name) {
      await ses.cookies.remove(url, name);
    },
  };
}

export async function logoutCrmWorkspace(
  getSession: (partitionName: string) => Session,
  workspaceId: string,
  baseUrl: string,
): Promise<string> {
  const partitionName = crmPartitionForWorkspace(workspaceId);
  const ses = getSession(partitionName);
  await logoutCrmSession(electronCookieStore(ses), baseUrl);
  await ses.clearStorageData({
    storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage"],
  });
  return partitionName;
}

export function crmLoginPartition(workspaceId: string): string {
  return crmPartitionForWorkspace(workspaceId);
}

/**
 * The CRM login contract guarantees auth_token. tenant_id is optional: the
 * CRM resolves the default tenant server-side when the cookie is absent.
 * Impersonated sessions must remain blocked for personal integrations.
 */
export function hasCrmAuthenticatedSession(cookies: {
  authToken?: string | undefined;
  tenantId?: string | undefined;
  impersonation?: string | undefined;
}): boolean {
  return Boolean(cookies.authToken?.trim() && !cookies.impersonation?.trim());
}

/** Settings stays reachable before CRM login so recovery/update actions cannot deadlock. */
export function crmSurfaceAllowedWithoutLogin(surface: string): boolean {
  return surface === "crm" || surface === "settings";
}
