#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "apps/desktop/release");

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function writeChecksums() {
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`release dir missing: ${releaseDir}`);
  }
  const files = fs
    .readdirSync(releaseDir)
    .filter((f) => /\.(deb|AppImage|rpm|exe)$/i.test(f));
  const lines = files
    .sort()
    .map((f) => `${sha256File(path.join(releaseDir, f))}  ${f}`)
    .join("\n");
  const out = path.join(releaseDir, "SHA256SUMS");
  fs.writeFileSync(out, lines ? `${lines}\n` : "", "utf8");
  return out;
}

function writeSbom() {
  let packages = [];
  try {
    const raw = execFileSync("pnpm", ["list", "-r", "--json", "--depth", "0"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    packages = JSON.parse(raw);
  } catch {
    packages = [];
  }
  const components = [];
  const list = Array.isArray(packages) ? packages : [packages];
  for (const pkg of list) {
    if (!pkg?.name) continue;
    components.push({
      type: "library",
      name: pkg.name,
      version: pkg.version || "0.0.0",
      purl: `pkg:npm/${pkg.name}@${pkg.version || "0.0.0"}`,
    });
    const deps = pkg.dependencies || {};
    for (const [name, meta] of Object.entries(deps)) {
      const version =
        typeof meta === "object" && meta && "version" in meta ? String(meta.version) : "";
      components.push({
        type: "library",
        name,
        version: version || "0.0.0",
        purl: `pkg:npm/${name}@${version || "0.0.0"}`,
      });
    }
  }
  fs.mkdirSync(releaseDir, { recursive: true });
  const out = path.join(releaseDir, "sbom.cdx.json");
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: {
        type: "application",
        name: "adr-workspace",
        version: JSON.parse(fs.readFileSync(path.join(root, "apps/desktop/package.json"), "utf8"))
          .version,
      },
    },
    components,
  };
  fs.writeFileSync(out, JSON.stringify(sbom, null, 2), "utf8");
  return out;
}

const checksums = writeChecksums();
const sbom = writeSbom();
console.log(`wrote ${checksums}`);
console.log(`wrote ${sbom}`);
