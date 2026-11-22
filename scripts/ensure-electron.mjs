#!/usr/bin/env node
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRequire = createRequire(path.join(root, "apps/desktop/package.json"));
const packagePath = desktopRequire.resolve("electron/package.json");
// Use the vendor installer: it verifies checksums and downloads from CastLabs.
execFileSync(process.execPath, [path.join(path.dirname(packagePath), "install.js")], { stdio: "inherit" });
