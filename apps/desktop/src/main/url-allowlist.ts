import path from "node:path";
import { fileURLToPath } from "node:url";

export const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function isAllowedExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      ALLOWED_EXTERNAL_PROTOCOLS.has(u.protocol) &&
      !u.username &&
      !u.password &&
      (u.protocol === "mailto:" || Boolean(u.hostname))
    );
  } catch {
    return false;
  }
}

/**
 * A página é do próprio app (arquivo dentro da pasta `shell`)? Segunda tranca
 * do IPC privilegiado: uma view do shell levada para fora continua com o
 * preload, e conferir só o `sender` não distingue a página nova da nossa.
 */
export function isShellPageUrl(url: string, shellDir: string): boolean {
  let file: string;
  try {
    if (!url.startsWith("file:")) return false;
    file = fileURLToPath(url);
  } catch {
    return false;
  }
  const relative = path.relative(shellDir, file);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
