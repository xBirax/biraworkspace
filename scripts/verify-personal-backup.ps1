$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$base = Join-Path $repo ('.test-results\backup-' + [guid]::NewGuid().ToString('N'))
$profile = Join-Path $base 'profile'
$backups = Join-Path $base 'backups'
$restored = Join-Path $base 'restored'
foreach ($destination in @($profile,$backups,$restored)) {
  if (-not [IO.Path]::GetFullPath($destination).StartsWith($base + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Destino fora do laboratório' }
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
}
New-Item -ItemType Directory -Path (Join-Path $profile 'vault'),(Join-Path $profile 'Partitions\teste'),(Join-Path $profile 'Cache') | Out-Null
[IO.File]::WriteAllText((Join-Path $profile 'state.v1.json'),'{"schemaVersion":1,"fixture":true}')
[IO.File]::WriteAllText((Join-Path $profile 'vault\fixture.bin'),'cofre sintetico sem credenciais')
[IO.File]::WriteAllText((Join-Path $profile 'Partitions\teste\fixture.txt'),'sessao sintetica')
[IO.File]::WriteAllText((Join-Path $profile 'Cache\descartavel.txt'),'cache')
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $repo 'apps\desktop\build\backup-profile.ps1') -ProfileDir $profile -BackupsRoot $backups -Label manual -ProcessName 'bira-backup-fixture-inexistente'
if ($LASTEXITCODE -ne 0) { throw 'Script de backup falhou' }
$status=Get-Content -LiteralPath (Join-Path $backups 'backup-status.json') -Raw | ConvertFrom-Json
if ($status.state -ne 'done') { throw 'Backup nao confirmado' }
$snapshot = Join-Path $status.target 'profile'
if (-not [IO.Path]::GetFullPath($snapshot).StartsWith($backups + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Snapshot fora do laboratório' }
Get-ChildItem -LiteralPath $snapshot -Force | Copy-Item -Destination $restored -Recurse
foreach ($name in @('state.v1.json','vault\fixture.bin','Partitions\teste\fixture.txt')) {
  if ((Get-FileHash -LiteralPath (Join-Path $profile $name)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $restored $name)).Hash) { throw "Restauracao divergente: $name" }
}
if (Test-Path -LiteralPath (Join-Path $restored 'Cache\descartavel.txt')) { throw 'Cache foi copiado' }
@{passed=$true;source=$profile;snapshot=$snapshot;restored=$restored;checks=@('estado','cofre sintetico','particao sintetica','cache excluido','restauracao byte a byte')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $repo '.test-results\backup-restore.json') -Encoding utf8
# Simula os dois erros sem esgotar o disco real.
$helper=Join-Path $base 'simulate.ps1'
@'
param($Script,$Profile,$Root,$Failure)
function robocopy {
  if($Failure -eq 'disk'){ $global:LASTEXITCODE=8; return }
  $target=Split-Path $args[1]
  New-Item -ItemType Directory -Force $args[1] | Out-Null
  Copy-Item -LiteralPath (Join-Path $args[0] 'state.v1.json') -Destination $args[1]
  New-Item -ItemType Directory -Path (Join-Path $target 'backup-info.json.tmp') | Out-Null
  $global:LASTEXITCODE=1
}
& $Script -ProfileDir $Profile -BackupsRoot $Root -ProcessName 'bira-backup-fixture-inexistente'
exit $LASTEXITCODE
'@ | Set-Content -LiteralPath $helper -Encoding utf8
foreach ($failure in 'disk','manifest') {
  $destination=Join-Path $base $failure
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper (Join-Path $repo 'apps/desktop/build/backup-profile.ps1') $profile $destination $failure
  if ($LASTEXITCODE -eq 0) {throw "Falha simulada retornou sucesso: $failure"}
  if ((Get-Content (Join-Path $destination 'backup-status.json') -Raw | ConvertFrom-Json).state -ne 'failed'){throw 'Status incorreto'}
}
Write-Output 'PASS: copia, restauracao e falhas de disco e manifesto'
