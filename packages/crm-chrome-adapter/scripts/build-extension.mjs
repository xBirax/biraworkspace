#!/usr/bin/env node
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgRoot, "../..");
// Mesma regra do desktop (resolveVendorExtensionDir): a pasta mais nova ganha,
// para não existir dois lugares onde esquecer de subir a versão.
const vendorRoot = path.join(repoRoot, "vendor");
const vendor = path.join(
  vendorRoot,
  fs
    .readdirSync(vendorRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^adr-crm-extension-\d/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }))
    .at(-1),
);
const outDir = path.join(pkgRoot, "dist-extension");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(pkgRoot, "src/shared-entry.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome102"],
  outfile: path.join(outDir, "shared.js"),
  logLevel: "info",
});

const copyList = [
  "background.js",
  "content.js",
  "gmail-content.js",
  "wa-dom.js",
  "styles.css",
  "options.html",
  "options.js",
  "managed-storage-schema.json",
  "manifest.json",
];

for (const file of copyList) {
  fs.copyFileSync(path.join(vendor, file), path.join(outDir, file));
}

fs.cpSync(path.join(vendor, "icons"), path.join(outDir, "icons"), { recursive: true });

// O gate continua: o que sai tem que ser a versão da pasta usada, não outra.
// Fixar o número aqui só quebrava o build a cada release da extensão.
const expected = path.basename(vendor).replace("adr-crm-extension-", "");
const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
if (manifest.version !== expected) {
  throw new Error(`Expected extension version ${expected}, got ${manifest.version}`);
}

console.log(`Built MV3 extension at ${outDir} (v${manifest.version})`);
