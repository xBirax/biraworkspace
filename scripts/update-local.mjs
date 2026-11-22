/**
 * Atualiza a instalação local sem passar pelo instalador NSIS.
 *
 * Por que isto existe: o pacote não é assinado com Authenticode, e o Smart App
 * Control do Windows recusa executar o INSTALADOR por não conseguir confirmar o
 * editor. O binário do app, esse ele roda normalmente — o bloqueio é do
 * instalador, não do executável. Então copiamos o `win-unpacked` por cima e
 * pulamos o instalador inteiro.
 *
 * O que isso preserva, e por que importa:
 *  - a assinatura VMP da CastLabs vai junto (`adr-workspace.exe.sig`), então o
 *    Spotify continua tocando — em `pnpm dev` não há VMP e ele leva 403;
 *  - `app.isPackaged` continua true, então o userData segue sendo
 *    "ADR Workspace" e não "ADR Workspace Dev": os logins ficam onde estão;
 *  - o desinstalador do NSIS não é apagado (copiamos por cima, sem espelhar).
 *
 * Uso: corepack pnpm run update:local
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const unpacked = path.join(here, "..", "apps", "desktop", "release", "win-unpacked");
const localAppData = process.env["LOCALAPPDATA"] || "";
// O NSIS instala na pasta derivada do nome do PACOTE (@adr/desktop -> @adrdesktop),
// não do executável; "adr-workspace" fica como fallback de instalação antiga.
const installed =
  ["@adrdesktop", "adr-workspace"]
    .map((dir) => path.join(localAppData, "Programs", dir))
    .find((dir) => fs.existsSync(path.join(dir, "adr-workspace.exe"))) ||
  path.join(localAppData, "Programs", "@adrdesktop");
const exeName = "adr-workspace.exe";

function fail(message) {
  console.error(`update:local — ${message}`);
  process.exit(1);
}

if (process.platform !== "win32") fail("só faz sentido no Windows");
if (!fs.existsSync(path.join(unpacked, exeName))) {
  fail(`nada empacotado em ${unpacked}. Rode antes: corepack pnpm --filter @adr/desktop run pack:dir`);
}
if (!fs.existsSync(path.join(installed, exeName))) {
  fail(`instalação não encontrada em ${installed}. Instale uma vez pelo .exe e depois use este script.`);
}
// Sem a assinatura VMP o Spotify para de tocar, e o sintoma (play sem som) não
// aponta para o build. Melhor recusar aqui do que entregar isso instalado.
// ADR_SKIP_VMP=1 é escolha explícita (máquina sem conta EVS, teste rápido): aí
// só avisa.
if (!fs.existsSync(path.join(unpacked, `${exeName}.sig`))) {
  if (process.env["ADR_SKIP_VMP"] !== "1") {
    fail("build sem assinatura VMP — o Spotify não tocaria. Empacote sem ADR_SKIP_VMP.");
  }
  console.warn(
    "aviso: build sem assinatura VMP (ADR_SKIP_VMP=1) — Spotify e outros conteúdos com DRM não tocam até a próxima atualização oficial.",
  );
}

/** WM_CLOSE, não kill: fechar pelo caminho normal grava os cookies (before-quit). */
function closeApp() {
  const script = [
    "$p = Get-Process adr-workspace -ErrorAction SilentlyContinue",
    "if (-not $p) { exit 0 }",
    "$p | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.CloseMainWindow() | Out-Null }",
    "for ($i = 0; $i -lt 30; $i++) {",
    "  if (-not (Get-Process adr-workspace -ErrorAction SilentlyContinue)) { exit 0 }",
    "  Start-Sleep -Milliseconds 500",
    "}",
    "exit 1",
  ].join("; ");
  try {
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: "inherit",
    });
  } catch {
    fail("o app não fechou em 15s. Feche na mão e rode de novo (matar o processo perde login).");
  }
}

console.log("fechando o ADR Workspace…");
closeApp();

console.log(`copiando ${unpacked} -> ${installed}`);
// Recursivo e sobrescrevendo, SEM espelhar: espelhar apagaria o
// "Uninstall adr-workspace.exe", que o NSIS deixou aqui e o Windows ainda usa.
fs.cpSync(unpacked, installed, { recursive: true, force: true });

const version = JSON.parse(
  fs.readFileSync(path.join(here, "..", "apps", "desktop", "package.json"), "utf8"),
).version;
console.log(`ok — ADR Workspace ${version} instalado. Abra pelo atalho de sempre.`);
