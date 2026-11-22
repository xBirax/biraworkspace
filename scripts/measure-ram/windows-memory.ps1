param(
  [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$ImageName = 'adr-workspace'
)
$ErrorActionPreference = 'Stop'
# Só leitura: WorkingSetPrivate é RAM residente exclusiva; PrivateBytes é commit.
$processIds = @(Get-Process -Name $ImageName -ErrorAction Stop | Select-Object -ExpandProperty Id)
$rows = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
  Where-Object { $processIds -contains [int]$_.IDProcess } |
  ForEach-Object {
    [pscustomobject]@{
      pid = [int]$_.IDProcess
      workingSetMb = [math]::Round([double]$_.WorkingSet / 1MB, 1)
      privateWorkingSetMb = [math]::Round([double]$_.WorkingSetPrivate / 1MB, 1)
      privateCommitMb = [math]::Round([double]$_.PrivateBytes / 1MB, 1)
    }
  })
if (-not $rows.Count) { throw 'Nenhum processo foi medido. Abra o app e repita.' }
foreach ($row in $rows) {
  if ($row.privateWorkingSetMb -gt $row.workingSetMb + 0.1) { throw 'Amostra de memória inconsistente. Repita a medição.' }
}
[pscustomobject]@{
  capturedAt = [DateTimeOffset]::Now.ToString('o')
  image = $ImageName
  processCount = $rows.Count
  workingSetMb = [math]::Round(($rows | Measure-Object workingSetMb -Sum).Sum, 1)
  privateWorkingSetMb = [math]::Round(($rows | Measure-Object privateWorkingSetMb -Sum).Sum, 1)
  privateCommitMb = [math]::Round(($rows | Measure-Object privateCommitMb -Sum).Sum, 1)
  processes = $rows
} | ConvertTo-Json -Depth 4
