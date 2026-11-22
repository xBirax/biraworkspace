import fs from "node:fs";
import path from "node:path";

const MARKER = ".electron44-backup.json";
const REBUILDABLE = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "ShaderCache",
  "GrShaderCache",
  "Crashpad",
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
]);

/** Run before Chromium opens any session. Copy locally; never move or clear data. */
export function backupBeforeElectron44(profilePath: string): string | null {
  const profile = path.resolve(profilePath);
  const marker = path.join(profile, MARKER);
  try {
    const saved = JSON.parse(fs.readFileSync(marker, "utf8")) as {
      complete?: boolean;
      profile?: string;
      backup?: string | null;
    };
    // Cópia completa uma vez basta: quem apagou a pasta para liberar espaço não
    // deve pagar outra cópia inteira do perfil (e o app fechando sem disco) a cada abertura.
    if (saved.complete === true && saved.profile === profile) {
      return typeof saved.backup === "string" && fs.existsSync(path.join(saved.backup, "backup-info.json"))
        ? saved.backup
        : null;
    }
  } catch {
    /* First upgraded start or incomplete marker: prepare a new backup. */
  }

  let backup: string | null = null;
  const existingData = ["state.v1.json", "Partitions", "Network", "Cookies", "Local Storage"].some(
    (name) => fs.existsSync(path.join(profile, name)),
  );
  if (existingData) {
    const parent = `${profile} Backups`;
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    // Cópia interrompida (app fechado à força no meio — a cópia é longa e não
    // mostra janela) não tem backup-info.json e não serve para restaurar. Sem
    // apagar, cada nova tentativa somava outra cópia parcial até faltar disco.
    for (const name of fs.readdirSync(parent)) {
      const dir = path.join(parent, name);
      if (name.startsWith("before-electron44-") && !fs.existsSync(path.join(dir, "backup-info.json"))) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    backup = fs.mkdtempSync(path.join(parent, "before-electron44-"));
    try {
      fs.cpSync(profile, path.join(backup, "profile"), {
        recursive: true,
        preserveTimestamps: true,
        filter: (source) => {
          if (
            source !== profile &&
            (REBUILDABLE.has(path.basename(source)) || path.basename(source) === MARKER)
          )
            return false;
          // Refuse links instead of silently omitting session data outside this profile.
          // A raiz pode ser junction (perfil movido para outro disco): ela é o perfil.
          if (source !== profile && fs.lstatSync(source).isSymbolicLink())
            throw new Error("Profile contains a symbolic link");
          return true;
        },
      });
      fs.writeFileSync(
        path.join(backup, "backup-info.json"),
        JSON.stringify(
          {
            createdAt: new Date().toISOString(),
            profile,
            targetElectronMajor: 44,
            note: "Cópia local anterior à migração. Restauração somente com o aplicativo fechado.",
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    } catch (error) {
      fs.rmSync(backup, { recursive: true, force: true });
      throw error;
    }
  }
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(`${marker}.tmp`, JSON.stringify({ complete: true, profile, backup }), {
    mode: 0o600,
  });
  fs.renameSync(`${marker}.tmp`, marker);
  return backup;
}
