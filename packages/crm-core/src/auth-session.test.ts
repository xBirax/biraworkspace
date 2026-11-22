import { describe, expect, it } from "vitest";
import {
  assertPersonalCrmSession,
  buildPersonalCrmHeaders,
  whoamiFromAuthMeApi,
  whoamiFromError,
  whoamiFromSessionApi,
  CrmAuthError,
} from "../src/auth-session.js";

describe("CRM personal session / whoami", () => {
  it("allows a normal logged-in user", () => {
    const auth = assertPersonalCrmSession({
      auth_token: "tok",
      tenant_id: "tenant-1",
    });
    expect(buildPersonalCrmHeaders(auth)).toEqual({
      Authorization: "Bearer tok",
      "x-tenant-id": "tenant-1",
    });
    expect(whoamiFromSessionApi({ context: { userId: "u1", tenantId: "tenant-1" } })).toEqual({
      hasCrm: true,
      scope: "tenant-1:u1",
    });
  });

  it("blocks impersonated sessions like the extension", () => {
    expect(() =>
      assertPersonalCrmSession({
        auth_token: "tok",
        tenant_id: "tenant-1",
        adr_impersonation_session: "active",
      }),
    ).toThrow(CrmAuthError);
    try {
      assertPersonalCrmSession({
        auth_token: "tok",
        adr_impersonation_session: "x",
      });
    } catch (error) {
      expect((error as CrmAuthError).code).toBe("IMPERSONATION_UNSUPPORTED");
      expect(whoamiFromError(error)).toEqual({ hasCrm: false });
    }
  });

  it("falls back to /api/auth/me shape", () => {
    expect(
      whoamiFromAuthMeApi({ user: { id: "u2", tenant: { id: "t2" } } }, "ignored"),
    ).toEqual({ hasCrm: true, scope: "t2:u2" });
  });
});
