import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import { isAllowedExternalUrl } from "./url-allowlist.js";

const CHROME_CANDIDATES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium-browser",
  "chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  // Windows
  path.join(
    process.env["PROGRAMFILES"] ?? "C:\\Program Files",
    "Google",
    "Chrome",
    "Application",
    "chrome.exe",
  ),
  path.join(
    process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
    "Google",
    "Chrome",
    "Application",
    "chrome.exe",
  ),
  path.join(process.env["LOCALAPPDATA"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
];

const BRAVE_CANDIDATES = [
  "brave-browser",
  "brave",
  "/usr/bin/brave-browser",
  "/usr/bin/brave",
  "/opt/brave.com/brave/brave-browser",
  // Windows
  path.join(
    process.env["PROGRAMFILES"] ?? "C:\\Program Files",
    "BraveSoftware",
    "Brave-Browser",
    "Application",
    "brave.exe",
  ),
  path.join(
    process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
    "BraveSoftware",
    "Brave-Browser",
    "Application",
    "brave.exe",
  ),
  path.join(
    process.env["LOCALAPPDATA"] ?? "",
    "BraveSoftware",
    "Brave-Browser",
    "Application",
    "brave.exe",
  ),
];

function isAbsoluteCandidate(c: string): boolean {
  return path.isAbsolute(c) || c.includes("/") || c.includes("\\");
}

// where/which é execFileSync: bloqueia o processo main, e openInPreferredBrowser
// roda a cada link externo. O caminho do navegador não muda com o app aberto.
const resolved = new Map<string[], string | null>();

function resolveBinary(candidates: string[]): string | null {
  if (resolved.has(candidates)) return resolved.get(candidates) ?? null;
  const found = lookupBinary(candidates);
  resolved.set(candidates, found);
  return found;
}

function lookupBinary(candidates: string[]): string | null {
  for (const c of candidates) {
    if (!c) continue;
    if (isAbsoluteCandidate(c)) {
      if (fs.existsSync(c)) return c;
      continue;
    }
    try {
      const finder = process.platform === "win32" ? "where" : "which";
      const out = execFileSync(finder, [c], { encoding: "utf8" }).trim();
      const first = out.split(/[\r\n]+/).find(Boolean);
      if (first && fs.existsSync(first)) return first;
    } catch {
      // not installed
    }
  }
  return null;
}

export function findChromeBinary(): string | null {
  return resolveBinary(CHROME_CANDIDATES);
}

export function findBraveBinary(): string | null {
  return resolveBinary(BRAVE_CANDIDATES);
}

export async function openInPreferredBrowser(
  url: string,
  prefer: "chrome" | "brave" | "auto" = "auto",
): Promise<{ ok: boolean; browser?: string; message?: string }> {
  if (!isAllowedExternalUrl(url)) {
    return { ok: false, message: "URL inválida" };
  }
  // `auto` delegates directly to the OS so every platform honors the browser
  // selected by the user. Detecting Chrome/Brave here would replace that
  // choice with whichever binary happens to be installed.
  if (prefer === "auto") {
    try {
      await shell.openExternal(url);
      return {
        ok: true,
        browser: "padrão do sistema",
        message: "Navegador padrão do sistema",
      };
    } catch {
      return { ok: false, message: "Não foi possível abrir o navegador padrão do sistema" };
    }
  }
  const bin = prefer === "chrome" ? findChromeBinary() : findBraveBinary();
  const name = prefer === "chrome" ? "Chrome" : "Brave";
  if (!bin) {
    return {
      ok: false,
      message: `${name} não encontrado. Escolha outro navegador em Configurações.`,
    };
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, [url], { detached: true, stdio: "ignore" });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
    return { ok: true, browser: name };
  } catch {
    // Respect the explicit choice even on failure; never silently use another profile/browser.
    return {
      ok: false,
      message: `Não foi possível abrir o ${name}. Revise o navegador em Configurações.`,
    };
  }
}
