#!/usr/bin/env node
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destPreload = path.join(root, "dist/preload");
const destShell = path.join(root, "dist/shell");

fs.mkdirSync(destPreload, { recursive: true });
fs.mkdirSync(destShell, { recursive: true });
for (const file of ["crm-preload.cjs", "composer-preload.cjs", "gmail-preload.cjs"]) fs.rmSync(path.join(destPreload, file), { force: true });
fs.rmSync(path.join(destShell, "titlebar.html"), { force: true });

const formActivity = fs.readFileSync(path.join(root, "src/preload/form-activity-preload.cjs"), "utf8");
fs.writeFileSync(path.join(destPreload, "form-activity-preload.cjs"), formActivity);
fs.writeFileSync(path.join(destPreload, "microsoft-badge-preload.cjs"), `${formActivity}\n${fs.readFileSync(path.join(root, "src/preload/microsoft-badge-preload.cjs"), "utf8")}`);
const vendor = path.resolve(root, "../../vendor/adr-crm-extension-0.15.5");
const waDom = ["shared.js", "wa-dom.js"].map(file => fs.readFileSync(path.join(vendor, file), "utf8"));
fs.copyFileSync(path.join(root, "src/main/translate-worker.py"), path.join(destPreload, "translate-worker.py"));
const personalScripts = ["personal-privacy.cjs", "whatsapp-transcripts.cjs", "whatsapp-translation.cjs"].map(file => fs.readFileSync(path.join(root, "src/preload", file), "utf8"));
fs.writeFileSync(path.join(destPreload, "personal-privacy.cjs"), [formActivity, ...waDom, ...personalScripts].join("\n"));
fs.copyFileSync(path.join(root, "src/preload/read-voice.js"), path.join(destPreload, "read-voice.js"));
const wa = path.join(root, "node_modules/@wppconnect/wa-js");
for (const name of ["wppconnect-wa.js", "wppconnect-wa.js.LICENSE.txt"]) fs.copyFileSync(path.join(wa, "dist", name), path.join(destPreload, name));
fs.copyFileSync(path.join(wa, "LICENSE"), path.join(destPreload, "wa-js-LICENSE"));
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
  "privacy-ui.js",
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

const digest=createHash("sha256");
for (const dir of ["main","preload","shell"]) {
  const base=path.join(root,"dist",dir);
  for (const name of fs.readdirSync(base,{recursive:true}).map(String).sort()) {
    const file=path.join(base,name);
    if (name==="build-id.json" || !fs.statSync(file).isFile() || (dir==="main" && !name.endsWith(".bundle.cjs"))) continue;
    const bytes=fs.readFileSync(file);
    digest.update(dir+"/"+name.replaceAll("\\","/")+"\0");
    digest.update(/\.(js|cjs|py|css|svg|html|json|txt)$/.test(name)?bytes.toString("utf8").replaceAll("\r\n","\n"):bytes);
  }
}
fs.writeFileSync(path.join(destPreload,"build-id.json"),JSON.stringify(digest.digest("hex").slice(0,16)));
console.log("copied preload + shell assets");
