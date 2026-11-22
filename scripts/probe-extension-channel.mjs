#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expect = process.argv.includes("--expect")
  ? process.argv[process.argv.indexOf("--expect") + 1]
  : null;

const base = "https://app.adragencia.com.br/extension-updates";
const xmlUrl = `${base}/update_manifest.xml`;
const crxUrl = `${base}/adr-crm-whatsapp.crx`;

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function crxManifestVersion(buf) {
  const idx = buf.indexOf(Buffer.from("PK\x03\x04"));
  const zipBuf = idx >= 0 ? buf.subarray(idx) : buf;
  const tmp = path.join("/tmp", `adr-crx-${process.pid}.zip`);
  fs.writeFileSync(tmp, zipBuf);
  const out = execFileSync("python3", ["-c", `
import zipfile, json
z=zipfile.ZipFile(${JSON.stringify(tmp)})
print(json.loads(z.read('manifest.json'))['version'])
`], { encoding: "utf8" }).trim();
  fs.unlinkSync(tmp);
  return out;
}

const xml = await fetchText(xmlUrl);
const xmlVersion = xml.match(/<updatecheck[^>]*\bversion="([^"]+)"/)?.[1] || null;
const crxVersion = crxManifestVersion(await fetchBuffer(crxUrl));
// A versão embutida é a pasta mais nova de vendor/ (como em extension-inject.ts).
const vendorDir = fs
  .readdirSync(path.join(root, "vendor"))
  .filter((name) => /^adr-crm-extension-\d/.test(name) && !name.endsWith(".sha256"))
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
  .at(-1);
const vendorManifest = JSON.parse(
  fs.readFileSync(path.join(root, "vendor", vendorDir, "manifest.json"), "utf8"),
);

const report = {
  xmlVersion,
  crxVersion,
  vendorZipVersion: vendorManifest.version,
  matchLive: xmlVersion === crxVersion,
  matchVendor: xmlVersion === vendorManifest.version && crxVersion === vendorManifest.version,
};

console.log(JSON.stringify(report, null, 2));

if (expect) {
  if (xmlVersion === expect && crxVersion === expect) process.exit(0);
  console.error(`Canal ao vivo não está em ${expect}`);
  process.exit(2);
}

if (!report.matchLive) process.exit(1);
process.exit(report.matchVendor ? 0 : 1);
