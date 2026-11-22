import { describe, expect, it } from "vitest";
import {
  crmLoginPartition,
  crmSurfaceAllowedWithoutLogin,
  hasCrmAuthenticatedSession,
  logoutCrmWorkspace,
} from "./crm-login.js";

describe("crm login view binding", () => {
  it("binds login view to workspace CRM partition", () => {
    const a = crmLoginPartition("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    const b = crmLoginPartition("bbbbbbbb-cccc-dddd-eeee-ffffffffffff");
    expect(a).not.toBe(b);
    expect(crmLoginPartition("default")).toBe("persist:crm-default");
  });

  it("logout clears only the target workspace session", async () => {
    const jars = new Map<string, Map<string, string>>();
    const getSession = (partitionName: string) => {
      if (!jars.has(partitionName)) jars.set(partitionName, new Map());
      const jar = jars.get(partitionName)!;
      return {
        cookies: {
          get: async (filter: { url: string; name?: string }) => {
            if (filter.name) {
              const value = jar.get(`${filter.url}::${filter.name}`);
              return value ? [{ name: filter.name, value }] : [];
            }
            return [];
          },
          set: async (cookie: { url: string; name: string; value: string }) => {
            jar.set(`${cookie.url}::${cookie.name}`, cookie.value);
          },
          remove: async (url: string, name: string) => {
            jar.delete(`${url}::${name}`);
          },
        },
        clearStorageData: async () => {
          jar.clear();
        },
      };
    };

    const baseUrl = "https://app.adragencia.com.br";
    const partA = crmLoginPartition("ws-aaaaaaa");
    const partB = crmLoginPartition("ws-bbbbbbb");
    await getSession(partA).cookies.set({ url: baseUrl, name: "auth_token", value: "a" });
    await getSession(partB).cookies.set({ url: baseUrl, name: "auth_token", value: "b" });

    await logoutCrmWorkspace(getSession as never, "ws-aaaaaaa", baseUrl);

    const aLeft = await getSession(partA).cookies.get({ url: baseUrl, name: "auth_token" });
    const bLeft = await getSession(partB).cookies.get({ url: baseUrl, name: "auth_token" });
    expect(aLeft).toHaveLength(0);
    expect(bLeft[0]?.value).toBe("b");
  });

  it("accepts the default CRM tenant without a tenant_id cookie", () => {
    expect(hasCrmAuthenticatedSession({ authToken: "token" })).toBe(true);
    expect(hasCrmAuthenticatedSession({ authToken: "token", tenantId: "tenant-1" })).toBe(true);
  });

  it("rejects missing auth and impersonated CRM sessions", () => {
    expect(hasCrmAuthenticatedSession({})).toBe(false);
    expect(hasCrmAuthenticatedSession({ authToken: "token", impersonation: "active" })).toBe(false);
  });

  it("keeps CRM settings reachable before login for recovery and updates", () => {
    expect(crmSurfaceAllowedWithoutLogin("crm")).toBe(true);
    expect(crmSurfaceAllowedWithoutLogin("settings")).toBe(true);
    expect(crmSurfaceAllowedWithoutLogin("service:whatsapp")).toBe(false);
  });
});
