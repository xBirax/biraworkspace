import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isAllowedExternalUrl, isShellPageUrl } from "./url-allowlist.js";

describe("isAllowedExternalUrl", () => {
  it("allows http(s) and mailto", () => {
    expect(isAllowedExternalUrl("https://example.com")).toBe(true);
    expect(isAllowedExternalUrl("mailto:a@b.com")).toBe(true);
  });

  it("blocks dangerous schemes", () => {
    expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("isShellPageUrl", () => {
  // Pasta com espaço e dentro do asar, como no app instalado.
  const shellDir = path.join(os.tmpdir(), "ADR Workspace", "resources", "app.asar", "dist", "shell");
  const page = (file: string) => pathToFileURL(path.join(shellDir, file)).href;

  it("aceita as páginas do shell, com ou sem query", () => {
    expect(isShellPageUrl(page("index.html"), shellDir)).toBe(true);
    expect(isShellPageUrl(`${page("prompt.html")}?id=3&secret=1`, shellDir)).toBe(true);
  });

  it("recusa página de fora, mesmo vinda de arquivo local", () => {
    expect(isShellPageUrl("https://web.whatsapp.com/", shellDir)).toBe(false);
    expect(isShellPageUrl(pathToFileURL(path.join(os.tmpdir(), "evil.html")).href, shellDir)).toBe(false);
    expect(isShellPageUrl(pathToFileURL(path.join(shellDir, "..", "main", "x.html")).href, shellDir)).toBe(false);
    expect(isShellPageUrl(pathToFileURL(`${shellDir}-evil${path.sep}index.html`).href, shellDir)).toBe(false);
    expect(isShellPageUrl("about:blank", shellDir)).toBe(false);
  });
});
