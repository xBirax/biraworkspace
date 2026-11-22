export type CrmSessionCookies = {
  auth_token?: string;
  tenant_id?: string;
  adr_impersonation_session?: string;
};

export type PersonalCrmAuth = {
  token: string;
  tenantId: string;
};

export class CrmAuthError extends Error {
  code: string;
  status?: number;

  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = "CrmAuthError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

/** Extension parity: WhatsApp CRM features require a personal (non-impersonated) session. */
export function assertPersonalCrmSession(cookies: CrmSessionCookies): PersonalCrmAuth {
  if (cookies.adr_impersonation_session) {
    throw new CrmAuthError(
      "A integração fica bloqueada durante o acesso como outro usuário. Encerre a impersonação para continuar.",
      "IMPERSONATION_UNSUPPORTED",
      403,
    );
  }
  if (!cookies.auth_token) {
    throw new CrmAuthError(
      "Faça login no CRM para usar este recurso.",
      "NOT_CONFIGURED",
      401,
    );
  }
  return {
    token: cookies.auth_token,
    tenantId: String(cookies.tenant_id || "").trim(),
  };
}

export function buildPersonalCrmHeaders(
  auth: PersonalCrmAuth,
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
    ...extra,
  };
  if (auth.tenantId) headers["x-tenant-id"] = auth.tenantId;
  return headers;
}

export type WhoamiData = { hasCrm: boolean; scope?: string };

export function whoamiFromSessionApi(data: {
  context?: { userId?: string; tenantId?: string };
}): WhoamiData {
  const userId = String(data?.context?.userId || "").trim();
  const tenantId = String(data?.context?.tenantId || "").trim();
  return {
    hasCrm: Boolean(userId && tenantId),
    ...(userId && tenantId ? { scope: `${tenantId}:${userId}` } : {}),
  };
}

export function whoamiFromAuthMeApi(
  data: { user?: { id?: string; tenant?: { id?: string } } },
  fallbackTenantId = "",
): WhoamiData {
  const userId = String(data?.user?.id || "").trim();
  const tenantId = String(data?.user?.tenant?.id || fallbackTenantId || "").trim();
  return {
    hasCrm: Boolean(userId && tenantId),
    ...(userId && tenantId ? { scope: `${tenantId}:${userId}` } : {}),
  };
}

/** Maps auth/whoami failures the same way as extension 0.12.5. */
export function whoamiFromError(error: unknown): WhoamiData | null {
  const err = error as { status?: number; code?: string };
  if (
    err?.status === 401 ||
    err?.status === 403 ||
    err?.code === "NOT_CONFIGURED" ||
    err?.code === "IMPERSONATION_UNSUPPORTED"
  ) {
    return { hasCrm: false };
  }
  return null;
}
