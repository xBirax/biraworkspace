# ADR Workspace - copia do perfil (logins, cookies, estado, cofre) com o app FECHADO.
#
# Usado em dois lugares:
#  - pelo instalador (build/installer.nsh), a cada instalacao/atualizacao,
#    antes de a versao nova abrir o perfil pela primeira vez;
#  - pelo botao "Fazer backup agora" das Configuracoes: o app agenda este
#    script, fecha, e o script espera o app sair, copia e reabre o app.
#
# Copiar com o app aberto pega o banco de cookies e o IndexedDB do WhatsApp no
# meio de uma escrita; por isso a espera. Caches regeneraveis ficam de fora.
# Mantem as ultimas $Keep copias de cada tipo (auto/manual); as outras
# (antes-*, before-electron44-*) nunca sao apagadas aqui.
#
# As copias ficam em %LOCALAPPDATA% (nao em Roaming): perfil movel de empresa
# sincronizaria GBs de backup a cada logon. O estado da copia vai para
# backup-status.json: o app avisa se for aberto no meio dela e se ela falhou.
#
# Texto so em ASCII: o PowerShell 5.1 le .ps1 sem BOM como ANSI.
param(
  [string]$ProfileDir = (Join-Path $env:APPDATA "ADR Workspace"),
  [string]$Label = "auto",
  [int]$Keep = 3,
  [int]$WaitPid = 0,
  [string]$Relaunch = "",
  [string]$ProcessName = "adr-workspace",
  [string]$BackupsRoot = (Join-Path $env:LOCALAPPDATA "ADR Workspace Backups")
)
$ErrorActionPreference = "Continue"
$backupsRoot = $BackupsRoot
$logFile = Join-Path $backupsRoot "backup.log"
$statusFile = Join-Path $backupsRoot "backup-status.json"

function Set-Status([hashtable]$fields) {
  try {
    New-Item -ItemType Directory -Force $backupsRoot | Out-Null
    $fields | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath $statusFile
  } catch {}
}

# So o app DESTA sessao do Windows: numa maquina compartilhada (outro usuario
# logado, RDP) o ADR Workspace de outra pessoa nao pode travar esta copia.
$mySession = (Get-Process -Id $PID).SessionId
function Get-App { Get-Process $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $mySession } }

function Log([string]$message) {
  try {
    New-Item -ItemType Directory -Force $backupsRoot | Out-Null
    Add-Content -LiteralPath $logFile -Value ("{0} {1}" -f (Get-Date -Format "s"), $message)
  } catch {}
}

# rmdir /s /q apaga a juncao, nunca o destino dela. Remove-Item -Recurse do
# PowerShell 5.1 pode entrar numa juncao e apagar o que esta do outro lado.
function Remove-Folder([string]$path) {
  if (Test-Path -LiteralPath $path) { & cmd.exe /d /c rmdir /s /q "$path" 2>$null }
}

function Start-App {
  if (-not $Relaunch) { return }
  # Ainda aberto (nao fechou a tempo): reabrir so bateria na trava de instancia
  # unica e o processo novo sairia - o que ja esta aberto continua servindo.
  if (Get-App) { return }
  Start-Process -FilePath $Relaunch
}

if (-not (Test-Path -LiteralPath (Join-Path $ProfileDir "state.v1.json"))) {
  Log "sem perfil em $ProfileDir; nada a copiar"
  exit 0
}

# --- esperar o app fechar ---------------------------------------------------
if ($WaitPid -gt 0) {
  try { Wait-Process -Id $WaitPid -Timeout 60 -ErrorAction SilentlyContinue } catch {}
}
for ($i = 0; $i -lt 60; $i++) {
  if (-not (Get-App)) { break }
  Start-Sleep -Milliseconds 500
}
if (Get-App) {
  Log "app ainda aberto apos 30 s; copia cancelada para nao pegar arquivos pela metade"
  Set-Status @{ state = "failed"; label = $Label; finishedAt = (Get-Date).ToString("o"); message = "O app nao fechou em 30 s (algum aviso aberto?). Feche os avisos e use Fazer backup agora." }
  Start-App
  exit 1
}

# --- copias interrompidas (desligou no meio, instalador morto) -----------------
# Sem backup-info.json e com mais de 6 h: nunca vai terminar, so ocupa disco.
Get-ChildItem -LiteralPath $backupsRoot -Directory -ErrorAction SilentlyContinue |
  Where-Object {
    ($_.Name -like "auto-*" -or $_.Name -like "manual-*") -and
    -not (Test-Path (Join-Path $_.FullName "backup-info.json")) -and
    $_.CreationTime -lt (Get-Date).AddHours(-6)
  } |
  ForEach-Object {
    Remove-Folder $_.FullName
    Log "copia interrompida removida: $($_.Name)"
  }

# --- copiar -------------------------------------------------------------------
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $backupsRoot "$Label-$stamp"
Set-Status @{ state = "running"; label = $Label; startedAt = (Get-Date).ToString("o") }
$skip = @("Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache",
  "ShaderCache", "GrShaderCache", "Crashpad", "CacheStorage")
# /XJ: nao seguir juncoes - so o que esta de fato dentro do perfil.
& robocopy $ProfileDir (Join-Path $target "profile") /E /XJ /COPY:DAT /R:1 /W:1 /NFL /NDL /NP /NJH /NJS `
  /XD @skip /XF SingletonLock SingletonCookie SingletonSocket "*.tmp" | Out-Null
$code = $LASTEXITCODE
if ($code -ge 8) {
  Log "robocopy falhou ($code); copia incompleta removida"
  Remove-Folder $target
  Set-Status @{ state = "failed"; label = $Label; finishedAt = (Get-Date).ToString("o");
    message = "A copia do perfil falhou (robocopy $code). Feche o app e use Fazer backup agora." }
} else {
  @{ profile = $ProfileDir; label = $Label; createdAt = (Get-Date).ToString("o") } |
    ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $target "backup-info.json")
  Log "copia pronta em $target"
  $size = (Get-ChildItem -LiteralPath $target -Recurse -File -Force -ErrorAction SilentlyContinue |
    Measure-Object Length -Sum).Sum
  Set-Status @{ state = "done"; label = $Label; finishedAt = (Get-Date).ToString("o"); target = $target;
    sizeBytes = [int64]$size }

  # --- manter so as ultimas $Keep do mesmo tipo -------------------------------
  $prefix = ($Label -split "-")[0]
  Get-ChildItem -LiteralPath $backupsRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "$prefix-*" -and (Test-Path (Join-Path $_.FullName "backup-info.json")) } |
    # Pela data da copia, nao pelo nome: "auto-0.1.9" vs "auto-0.1.10" ordenaria errado.
    Sort-Object { (Get-Item -LiteralPath (Join-Path $_.FullName "backup-info.json")).LastWriteTimeUtc } -Descending |
    Select-Object -Skip $Keep |
    ForEach-Object {
      Remove-Folder $_.FullName
      Log "copia antiga removida: $($_.Name)"
    }
}

Start-App
exit 0
