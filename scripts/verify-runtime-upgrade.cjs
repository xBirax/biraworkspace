const { createRequire } = require("node:module");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const desktopRequire = createRequire(path.join(root, "apps/desktop/package.json"));
const electronPackage = desktopRequire.resolve("electron/package.json");
const electronRequire = createRequire(electronPackage);

(async () => {
  const { downloadArtifact } = electronRequire("@electron/get");
  const { extract } = electronRequire("@electron-internal/extract-zip");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "adr-runtime-upgrade-"));
  const previous = path.join(temp, "previous");
  const profile = path.join(temp, "profile");
  fs.mkdirSync(previous);
  fs.mkdirSync(profile);
  const archive = await downloadArtifact({
    version: "35.7.5+wvcus",
    artifactName: "electron",
    platform: process.platform,
    arch: process.arch,
    mirrorOptions: { mirror: "https://github.com/castlabs/electron-releases/releases/download/" },
  });
  await extract(archive, { dir: previous });
  const exe = process.platform === "win32" ? "electron.exe" : "electron";
  const fixture = path.join(__dirname, "runtime-session-fixture.cjs");
  const backup = path.join(root, "apps/desktop/dist/main/runtime-profile-backup.js");
  const flags = process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(previous, exe), [...flags, fixture, "seed", profile, backup], {
    env,
    stdio: "inherit",
    timeout: 60000,
  });
  // Match production: backup while no Chromium session is using the profile.
  // Creating a BrowserWindow first opens default-session LevelDB on Windows.
  const { backupBeforeElectron44 } = await import(pathToFileURL(backup).href);
  const copy = backupBeforeElectron44(profile);
  if (
    !copy ||
    fs.readFileSync(path.join(copy, "profile", "state.v1.json"), "utf8") !== "fixture-state"
  )
    throw new Error("Backup failed");
  execFileSync(
    path.join(path.dirname(electronPackage), "dist", exe),
    [...flags, fixture, "verify", profile, backup],
    { env, stdio: "inherit", timeout: 60000 },
  );
  const seeded = JSON.parse(fs.readFileSync(path.join(profile, "seed-result.json"), "utf8"));
  const checked = JSON.parse(fs.readFileSync(path.join(profile, "verify-result.json"), "utf8"));
  if (!seeded.electron.startsWith("35.") || !checked.electron.startsWith("44.") || !checked.ok)
    throw new Error("Runtime versions did not match");
  console.log(JSON.stringify({ previous: seeded, current: checked, backup: "passed" }));
  // Keep only synthetic fixtures in the temporary directory for CI investigation.
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
