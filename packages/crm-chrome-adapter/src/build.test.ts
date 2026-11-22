import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("chrome MV3 adapter build", () => {
  it("rebuilds the vendored extension with shared.js from crm-core", () => {
    execFileSync(process.execPath, [path.join(pkgRoot, "scripts/build-extension.mjs")], {
      cwd: pkgRoot,
      stdio: "pipe",
    });
    const outDir = path.join(pkgRoot, "dist-extension");
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
    // Antes fixava "0.12.5" aqui: subir a extensão quebrava o teste por versão,
    // não por regressão. O que importa é sair a versão que está vendorizada.
    const vendorRoot = path.resolve(pkgRoot, "../../vendor");
    const newest = fs
      .readdirSync(vendorRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^adr-crm-extension-\d/.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }))
      .at(-1)!;
    expect(manifest.version).toBe(newest.replace("adr-crm-extension-", ""));
    expect(manifest.manifest_version).toBe(3);

    const background = fs.readFileSync(path.join(outDir, "background.js"), "utf8");
    for (const handler of [
      "whoami",
      "lookup",
      "getChatIdentity",
      "translate",
      "transcribeMessage",
      "quickReplies",
      "getTranscriptCache",
      "cacheTranscript",
      "gmailTranslate",
    ]) {
      expect(background).toContain(handler);
    }

    const shared = fs.readFileSync(path.join(outDir, "shared.js"), "utf8");
    expect(shared).toContain("CRMWAUtils");
    expect(shared).toContain("normalizeTranscriptCache");
    // Tudo que o content.js/background.js vendorizados chamam via U.<nome>.
    for (const name of ["chatKey", "isSameComposerText", "titleParts", "upsertTranscriptCache"]) {
      expect(shared).toContain(name);
    }

    const content = fs.readFileSync(path.join(outDir, "content.js"), "utf8");
    expect(content).toContain('"Desligar autoenvio"');
    // Um item por idioma no menu, não mais o "alternar".
    expect(content).toContain('"Autoenviar em Inglês"');
    expect(content).toContain('"Autoenviar em Espanhol"');
    expect(content).toContain("addBubbleEmailButtons");

    const gmail = fs.readFileSync(path.join(outDir, "gmail-content.js"), "utf8");
    expect(gmail).toContain("request('gmailTranslate'");
    // O Gmail exige Trusted Types: HTML atribuído como string é bloqueado e o
    // painel não monta (falhou assim do 0.15.3 ao 0.15.5, em silêncio). Só DOM.
    expect(gmail).not.toMatch(/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|createContextualFragment/);
  });
});
