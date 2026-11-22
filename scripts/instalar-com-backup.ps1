# Instala uma versão nova do ADR Workspace por cima da atual, guardando antes
# uma cópia do perfil (logins, cookies, estado, cofre).
#
# Ordem e por quê:
#  1. Fecha o app pela janela (WM_CLOSE), nunca matando o processo: o caminho
#     normal passa pelo before-quit, que grava os cookies. Matar perde login.
#  2. Copia %APPDATA%\ADR Workspace para "ADR Workspace Backups\antes-<versão>-<data>"
#     com o app FECHADO — copiar com o app aberto pega o banco de cookies no meio
#     de uma escrita. Caches regeneráveis ficam de fora.
#  3. Roda o instalador e espera ele terminar. O NSIS instala por cima, na mesma
#     pasta e com o mesmo appId: o userData não muda, as sessões continuam.
#
# Uso: powershell -ExecutionPolicy Bypass -File instalar-com-backup.ps1 -Installer <Setup.exe>
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  # Só para testar o script sem tocar no app e no perfil reais.
  [string]$ProfileDir = (Join-Path $env:APPDATA "ADR Workspace"),
  [string]$ProcessName = "adr-workspace"
)
$ErrorActionPreference = "Stop"

function Fail([string]$message) {
  Write-Host ""
  Write-Host "ERRO: $message" -ForegroundColor Red
  Write-Host ""
  Read-Host "Enter para sair"
  exit 1
}

$Installer = (Resolve-Path -LiteralPath $Installer -ErrorAction SilentlyContinue).Path
if (-not $Installer) { Fail "instalador não encontrado." }

$profileDir = $ProfileDir
if (-not (Test-Path -LiteralPath $profileDir)) { Fail "perfil não encontrado em $profileDir." }

# --- 1. fechar ---------------------------------------------------------------
$running = Get-Process $ProcessName -ErrorAction SilentlyContinue
if ($running) {
  Write-Host "Fechando o ADR Workspace (gravando os logins)..."
  $windows = $running | Where-Object { $_.MainWindowHandle -ne 0 }
  if (-not $windows) {
    Fail "o ADR Workspace está aberto sem janela visível. Abra a janela e feche pelo X, depois rode de novo."
  }
  $windows | ForEach-Object { $_.CloseMainWindow() | Out-Null }
  for ($i = 0; $i -lt 60; $i++) {
    if (-not (Get-Process $ProcessName -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
  }
  if (Get-Process $ProcessName -ErrorAction SilentlyContinue) {
    Fail "o app não fechou em 30 s. Feche pelo X da janela e rode de novo (não finalize pelo Gerenciador de Tarefas: perde login)."
  }
}

# --- 2. backup ---------------------------------------------------------------
$version = ([IO.Path]::GetFileNameWithoutExtension($Installer) -replace "^ADR-Workspace-Setup-", "")
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
# %LOCALAPPDATA%: perfil movel de empresa nao sincroniza GBs de backup.
$backup = Join-Path (Join-Path $env:LOCALAPPDATA "ADR Workspace Backups") "antes-$version-$stamp"
Write-Host "Copiando o perfil para $backup ..."
$skip = @("Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache",
  "ShaderCache", "GrShaderCache", "Crashpad", "CacheStorage")
& robocopy $profileDir (Join-Path $backup "profile") /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NP /XD @skip /XF SingletonLock SingletonCookie SingletonSocket | Out-Null
# robocopy: 0-7 = sucesso (com ou sem arquivos copiados); 8+ = falha.
if ($LASTEXITCODE -ge 8) { Fail "a cópia do perfil falhou (robocopy $LASTEXITCODE). Nada foi instalado." }
@{ profile = $profileDir; createdAt = (Get-Date).ToString("o"); installer = $Installer } |
  ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $backup "backup-info.json")
Write-Host "Backup pronto."

# --- 3. instalar -------------------------------------------------------------
Write-Host "Instalando $([IO.Path]::GetFileName($Installer)) ..."
try {
  # -Wait do PowerShell 5.1 espera tambem os filhos: o instalador abre o app no
  # fim e a janela ficava em "Instalando..." ate o app ser fechado.
  $proc = Start-Process -FilePath $Installer -PassThru
  $proc.WaitForExit()
} catch {
  Fail "o Windows não deixou o instalador rodar ($($_.Exception.Message)). Se apareceu aviso do Smart App Control, use 'Atualizar sem instalador' (ver LEIA-ME). O backup ficou em $backup."
}
if ($proc.ExitCode -ne 0) {
  Fail "o instalador terminou com código $($proc.ExitCode). O backup ficou em $backup."
}

Write-Host ""
Write-Host "Pronto. Abra o ADR Workspace pelo atalho de sempre." -ForegroundColor Green
Write-Host "Backup do perfil: $backup"
Write-Host ""
Read-Host "Enter para sair"
