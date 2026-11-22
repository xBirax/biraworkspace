import { describe, expect, it } from "vitest";
import {
  MemoryCookieStore,
  crmPartitionForWorkspace,
  logoutCrmSession,
  readCrmAuthCookies,
  writeCrmAuthCookies,
} from "../src/crm-auth.js";

describe("CRM auth per workspace", () => {
  const baseUrl = "https://app.adragencia.com.br";

  it("binds distinct partitions per workspace", () => {
    const a = crmPartitionForWorkspace("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    const b = crmPartitionForWorkspace("bbbbbbbb-cccc-dddd-eeee-ffffffffffff");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^persist:crm-/);
    expect(crmPartitionForWorkspace("default")).toBe("persist:crm-default");
  });

  it("logout on workspace A does not clear workspace B", async () => {
    const storeA = new MemoryCookieStore();
    const storeB = new MemoryCookieStore();
    await writeCrmAuthCookies(storeA, baseUrl, {
      auth_token: "token-a",
      tenant_id: "tenant-a",
    });
    await writeCrmAuthCookies(storeB, baseUrl, {
      auth_token: "token-b",
      tenant_id: "tenant-b",
    });

    await logoutCrmSession(storeA, baseUrl);

    expect(await readCrmAuthCookies(storeA, baseUrl)).toEqual({});
    expect(await readCrmAuthCookies(storeB, baseUrl)).toEqual({
      auth_token: "token-b",
      tenant_id: "tenant-b",
    });
  });
});
