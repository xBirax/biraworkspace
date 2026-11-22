#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destPreload = path.join(root, "dist/preload");
const destShell = path.join(root, "dist/shell");

fs.mkdirSync(destPreload, { recursive: true });
fs.mkdirSync(destShell, { recursive: true });
fs.rmSync(path.join(destShell, "titlebar.html"), { force: true });

const formActivity = fs.readFileSync(path.join(root, "src/preload/form-activity-preload.cjs"), "utf8");
fs.writeFileSync(path.join(destPreload, "form-activity-preload.cjs"), formActivity);
for (const file of ["crm-preload.cjs", "composer-preload.cjs", "microsoft-badge-preload.cjs"]) {
  fs.writeFileSync(path.join(destPreload, file), `${formActivity}\n${fs.readFileSync(path.join(root, "src/preload", file), "utf8")}`);
}
// The Gmail panel runs in Electron's isolated preload world. Never expose its
// CRM commands through contextBridge or execute the panel in the page world.
const vendorRoot = path.resolve(root, "../../vendor");
const vendorNames = fs.readdirSync(vendorRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^adr-crm-extension-\d/.test(entry.name))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
const gmailSource = fs.readFileSync(path.join(vendorRoot, vendorNames.at(-1) || "", "gmail-content.js"), "utf8");
// Gmail already has its own compose assistant. Keeping the generic composer
// preload here can cover its button and an exception there prevents mounting.
const gmailPreload = `if (location.origin === "https://mail.google.com" && location.pathname.startsWith("/mail/")) {\n  try {\n    const { ipcRenderer } = require("electron");\n    globalThis.adrGmailInvoke = (command, payload) => ipcRenderer.invoke("gmail:invoke", command, payload);\n    const mountAdrGmail = () => {\n      try {\n${gmailSource}\n        console.info("ADR_GMAIL_PANEL:" + (document.getElementById("adr-gmail-assistant") ? "mounted" : "missing"));\n      } catch (error) {\n        console.error("ADR_GMAIL_PANEL:error:" + String(error?.name || "unknown"));\n      }\n    };\n    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAdrGmail, { once: true });\n    else mountAdrGmail();\n  } catch (error) {\n    console.error("ADR_GMAIL_PANEL:bridge-error:" + String(error?.name || "unknown"));\n  }\n}\n`;
fs.writeFileSync(path.join(destPreload, "gmail-preload.cjs"), `${formActivity}\n${gmailPreload}`);
fs.copyFileSync(
  path.join(root, "src/shell/shell-preload.cjs"),
  path.join(destShell, "shell-preload.cjs"),
);
fs.copyFileSync(
  path.join(root, "src/shell/browser-preload.cjs"),
  path.join(destShell, "browser-preload.cjs"),
);
fs.copyFileSync(
  path.join(root, "src/shell/prompt-preload.cjs"),
  path.join(destShell, "prompt-preload.cjs"),
);
fs.copyFileSync(
  path.join(root, "src/shell/history-preload.cjs"),
  path.join(destShell, "history-preload.cjs"),
);

for (const file of [
  "index.html",
  "mini-bar.html",
  "mini-bar-preload.cjs",
  "panel.html",
  "panel.css",
  "optimizer-panel.js",
  "internal-surfaces.css",
  "overlay.html",
  "browser-toolbar.html",
  "history.html",
  "prompt.html",
  "fonts.css",
  "tokens.css",
  "theme.js",
  "whatsapp.svg",
  "gmail.svg",
  "calendar.svg",
  "drive.svg",
  "notion.svg",
  "trello.svg",
  "chatgpt.svg",
  "claude.svg",
  "gemini.svg",
  "meet.svg",
  "youtube.svg",
  "spotify.svg",
  "browser.svg",
  "instagram.svg",
  "tiktok.svg",
  "outlook.svg",
  "teams.svg",
  "settings.svg",
  "adr-logo.png",
  "taskbar-icon.png",
]) {
  // Asset ausente derruba o build (ENOENT): release sem UI não pode sair.
  fs.copyFileSync(path.join(root, "src/shell", file), path.join(destShell, file));
}

const fontsSrc = path.join(root, "src/shell/fonts");
const fontsDest = path.join(destShell, "fonts");
if (fs.existsSync(fontsSrc)) {
  fs.mkdirSync(fontsDest, { recursive: true });
  for (const name of fs.readdirSync(fontsSrc)) {
    fs.copyFileSync(path.join(fontsSrc, name), path.join(fontsDest, name));
  }
}

console.log("copied preload + shell assets");
