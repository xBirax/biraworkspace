#!/usr/bin/env node
/**
 * Collects host facts for the ADR Workspace reference matrix.
 * Safe to run on any Ubuntu machine/VM — prints JSON to stdout.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

function run(cmd, args = []) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readOsRelease() {
  const raw = fs.existsSync("/etc/os-release")
    ? fs.readFileSync("/etc/os-release", "utf8")
    : "";
  const map = {};
  for (const line of raw.split("\n")) {
    const i = line.indexOf("=");
    if (i === -1) continue;
    map[line.slice(0, i)] = line.slice(i + 1).replaceAll('"', "");
  }
  return map;
}

function memGiB() {
  const totalKb = Number(
    fs.readFileSync("/proc/meminfo", "utf8").match(/MemTotal:\s+(\d+)/)?.[1] ??
      0,
  );
  return Math.round((totalKb / 1024 / 1024) * 10) / 10;
}

function memClass(giB) {
  if (giB >= 28) return "32GB-class";
  if (giB >= 14) return "16GB-class";
  if (giB >= 10) return "12GB-class";
  return "below-12GB";
}

function chromePresent() {
  const candidates = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const p of candidates) {
    if (fileExists(p)) {
      const version =
        run(p, ["--product-version"]) || run(p, ["--version"]) || "unknown";
      return { present: true, path: p, version };
    }
  }
  return { present: false, path: null, version: null };
}

function bravePresent() {
  const candidates = ["/usr/bin/brave-browser", "/usr/bin/brave"];
  for (const p of candidates) {
    if (fileExists(p)) {
      const version =
        run(p, ["--product-version"]) || run(p, ["--version"]) || "unknown";
      return { present: true, path: p, version };
    }
  }
  return { present: false, path: null, version: null };
}

function sessionType() {
  const fromEnv =
    process.env.XDG_SESSION_TYPE ||
    (process.env.WAYLAND_DISPLAY ? "wayland" : null) ||
    (process.env.DISPLAY ? "x11" : null) ||
    "unknown";
  return fromEnv.toLowerCase();
}

const osRelease = readOsRelease();
const chrome = chromePresent();
const brave = bravePresent();
const ramGiB = memGiB();

const report = {
  collectedAt: new Date().toISOString(),
  hostname: os.hostname(),
  arch: os.arch(),
  platform: os.platform(),
  cpus: os.cpus().length,
  os: {
    id: osRelease.ID || null,
    versionId: osRelease.VERSION_ID || null,
    prettyName: osRelease.PRETTY_NAME || null,
    codename: osRelease.VERSION_CODENAME || null,
  },
  display: {
    sessionType: sessionType(),
    waylandDisplay: process.env.WAYLAND_DISPLAY || null,
    x11Display: process.env.DISPLAY || null,
    desktop: process.env.XDG_CURRENT_DESKTOP || null,
  },
  memory: {
    totalGiB: ramGiB,
    class: memClass(ramGiB),
  },
  browsers: {
    chrome,
    brave,
  },
  matrixTags: {
    ubuntu2404: osRelease.VERSION_ID === "24.04",
    ubuntu2604: osRelease.VERSION_ID === "26.04",
    wayland: sessionType() === "wayland",
    x11: sessionType() === "x11",
    ram16class: memClass(ramGiB) === "16GB-class",
    ram32class: memClass(ramGiB) === "32GB-class",
    chromePresent: chrome.present,
    braveAbsent: !brave.present,
  },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
