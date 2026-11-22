import type { ServiceInstance } from "@adr/contracts";
import type { Session } from "electron";

/**
 * WhatsApp rejects Electron's product tokens even on a supported Chromium.
 * Teams também: com "Electron" no User-Agent ele manda instalar o app.
 */
export function whatsappUserAgent(nativeUserAgent: string): string {
  // Keep the actual Chromium version, OS and architecture. Google keeps its
  // native identity in its separate session; no global override or page script.
  return nativeUserAgent.replace(/\s(?:ADRWorkspace|Electron)\/\S+/g, "");
}

/**
 * User-Agent de Chrome (sem os tokens do Electron) na sessão de quem recusa o
 * Electron: WhatsApp e a conta Microsoft (Outlook/Teams). Outros serviços não
 * são tocados — o Google depende da identidade nativa.
 */
export function configureSessionUserAgent(
  kind: ServiceInstance["kind"],
  ses: Pick<Session, "getUserAgent" | "setUserAgent">,
): string | undefined {
  // Partição da conta Microsoft é só de Outlook/Teams: dá para mudar a sessão inteira.
  if (kind !== "whatsapp" && kind !== "outlook" && kind !== "teams") return undefined;
  const userAgent = whatsappUserAgent(ses.getUserAgent());
  // Set before creating the view, so session requests and workers agree with it.
  ses.setUserAgent(userAgent);
  return userAgent;
}
