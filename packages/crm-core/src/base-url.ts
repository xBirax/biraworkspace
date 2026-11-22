const DEFAULT_BASE_URL = "https://app.adragencia.com.br";

export function normalizeAllowedBaseUrl(
  value: string | null | undefined,
  options: { allowLocalhost: boolean } = { allowLocalhost: false },
): string {
  try {
    const url = new URL(String(value || ""));
    const allowed = new Set<string>([DEFAULT_BASE_URL]);
    if (options.allowLocalhost) allowed.add("http://localhost:3000");
    if (allowed.has(url.origin) && (url.pathname === "/" || url.pathname === "")) {
      return url.origin;
    }
    return DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export function mapHttpStatusToCrmErrorCode(
  status: number,
):
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "NETWORK"
  | "UPSTREAM_ERROR"
  | "INVALID_REQUEST" {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 429) return "RATE_LIMITED";
  if (status === 400 || status === 422) return "INVALID_REQUEST";
  if (status === 503 || status === 504) return "NETWORK";
  return "UPSTREAM_ERROR";
}

export { DEFAULT_BASE_URL };
