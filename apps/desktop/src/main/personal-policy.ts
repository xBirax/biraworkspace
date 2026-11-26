export type PrivacyMode = "normal" | "discreet" | "presentation";
export const ADR_APP_URL = "https://app.adragencia.com.br/";

export function allowAdrBrowserRequest(
  request: Pick<Electron.OnBeforeRequestListenerDetails, "url" | "resourceType" | "referrer" | "webContentsId">,
  browserPage: string | undefined,
): boolean {
  // URLs de rede já normalizadas pelo Chromium. A barra final delimita a origem.
  const isApp = request.url.startsWith(ADR_APP_URL);
  const isAppSocket = request.resourceType === "webSocket" && request.url.startsWith("wss://app.adragencia.com.br/");
  if (!isApp && !isAppSocket) return false;
  if (request.resourceType === "mainFrame") return isApp && browserPage !== undefined;
  // O service worker pode carregar recursos do próprio app sem webContentsId.
  if (browserPage === undefined && request.webContentsId !== undefined) return false;
  return (request.referrer || browserPage || "").startsWith(ADR_APP_URL);
}
export function privacyMode(value: unknown): PrivacyMode {
  return value === "discreet" || value === "presentation" ? value : "normal";
}
export function isAdrEndpoint(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "adragencia.com.br" || host.endsWith(".adragencia.com.br");
  } catch { return false; }
}
export function protectedNotifications<T extends { serviceEnabled: Record<string, boolean> }>(
  settings: T, modes: Record<string, PrivacyMode>,
): T {
  const serviceEnabled = { ...settings.serviceEnabled };
  for (const [id, mode] of Object.entries(modes)) if (mode !== "normal") serviceEnabled[id] = false;
  return { ...settings, serviceEnabled };
}
