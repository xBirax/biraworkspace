$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:PATH = (Join-Path $PSScriptRoot '.tools\node-v22.23.5-win-x64') + ';' + $env:PATH
foreach ($task in @('build','typecheck','lint','test')) {
  & corepack.cmd pnpm $task
  if ($LASTEXITCODE -ne 0) { throw "Falhou: $task" }
}
& node.exe scripts/run-electron-test.cjs scripts/verify-tab-diagnostics.cjs
if ($LASTEXITCODE -ne 0) { throw 'Falhou: exportacao de falhas de navegacao' }
& node.exe scripts/run-electron-test.cjs scripts/verify-personal-runtime.cjs
if ($LASTEXITCODE -ne 0) { throw 'Falhou: Electron pessoal' }
& node.exe scripts/run-electron-test.cjs scripts/verify-electron-network.cjs
if ($LASTEXITCODE -ne 0) { throw 'Falhou: cancelamento de resposta de rede' }
& node.exe scripts/run-electron-test.cjs scripts/verify-notification-navigation.cjs
if ($LASTEXITCODE -ne 0) { throw 'Falhou: navegacao por notificacoes' }
& node.exe scripts/verify-shared-glossary.cjs
if ($LASTEXITCODE -ne 0) { throw 'Falhou: glossário compartilhado e reabertura' }
& node.exe scripts/run-electron-test.cjs apps/desktop/scripts/test-whatsapp-translation.cjs
if ($LASTEXITCODE -ne 0) { throw 'Falhou: tradução e envio' }
$packaged = Join-Path $PSScriptRoot 'apps/desktop/release/win-unpacked/resources/app.asar'
if (!(Test-Path -LiteralPath $packaged)) { throw 'Gere o pacote Windows antes da verificação de pacote.' }
try {
  $env:BIRA_TEST_PRELOAD_DIR = Join-Path $packaged 'dist/preload'
  & node.exe scripts/run-electron-test.cjs apps/desktop/scripts/test-whatsapp-translation.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Falhou: tradução no pacote' }
} finally { Remove-Item Env:BIRA_TEST_PRELOAD_DIR -ErrorAction SilentlyContinue }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/verify-personal-backup.ps1
if ($LASTEXITCODE -ne 0) { throw 'Falhou: backup e restauracao' }
