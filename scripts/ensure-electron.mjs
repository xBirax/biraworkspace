#!/usr/bin/env node
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import extract from "extract-zip";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRequire = createRequire(path.join(root, "apps/desktop/package.json"));
const packagePath = desktopRequire.resolve("electron/package.json");
// Use the vendor installer: it verifies checksums and downloads from CastLabs.
if (process.platform !== "win32") {
  execFileSync(process.execPath, [path.join(path.dirname(packagePath), "install.js")], { stdio: "inherit" });
} else {
  // Extrator JS: não depende da DLL nativa bloqueada em algumas instalações Windows.
  // downloadArtifact mantém a verificação pelos checksums publicados pelo fornecedor.
  const requireElectron = createRequire(packagePath);
  const { downloadArtifact } = requireElectron("@electron/get");
  const { version } = requireElectron("./package.json");
  const dir = path.dirname(packagePath);
  const archive = await downloadArtifact({
    version, artifactName: "electron", platform: "win32", arch: "x64",
    mirrorOptions: { mirror: "https://github.com/castlabs/electron-releases/releases/download/" },
    checksums: requireElectron("./checksums.json"),
  });
  await extract(archive, { dir: path.join(dir, "dist") });
  fs.writeFileSync(path.join(dir, "path.txt"), "electron.exe");
  console.log(`Electron ${version} instalado e checksum verificado.`);
}
