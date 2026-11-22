# ADR Workspace - gera o instalador Windows com assinatura Authenticode
# (certificado de criar-certificado.ps1) e confere o resultado.
#
# A senha do .pfx NUNCA vai para variavel de ambiente nem linha de comando: com
# CSC_LINK/CSC_KEY_PASSWORD o electron-builder repassa a senha ao signtool como
# "/p <senha>" (visivel na lista de processos e em logs de auditoria) e todo
# processo filho do build a herda. Aqui o .pfx e importado como NAO exportavel
# no repositorio do usuario so durante o build, o signtool assina pela impressao
# digital (win.signtoolOptions.certificateSha1), e o certificado sai com a
# chave no fim - mesmo se o build falhar.
#
# Ordem garantida pelo electron-builder: Authenticode no executavel, depois a
# assinatura VMP da CastLabs (scripts/vmp-sign.cjs, afterSign), depois o
# instalador assinado. Inverter quebraria o DRM (a VMP cobre o binario final).
#
# Com certificado AUTOASSINADO o build sai com
# win.verifyUpdateCodeSignature=false: o atualizador conferiria o editor do
# instalador novo e recusaria a atualizacao em todo computador que nao confia
# no certificado. Ver docs/ASSINATURA.md sobre o que isso deixa de proteger.
# Com certificado de autoridade publica, rode com -CertificadoPublico.
param(
  [string]$Pfx = (Join-Path $env:USERPROFILE ".adr-assinatura\adr-codesign.pfx"),
  [switch]$CertificadoPublico
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")

if (-not (Test-Path -LiteralPath $Pfx)) {
  Write-Host "Nao achei $Pfx. Rode antes scripts\assinatura\criar-certificado.ps1."
  exit 1
}

# O build do app nao precisa do certificado: roda antes de ele existir no Windows.
Push-Location $repo
try {
  & corepack pnpm --filter "@adr/desktop" run build
  if ($LASTEXITCODE -ne 0) { throw "build falhou" }
} finally {
  Pop-Location
}

$password = Read-Host -AsSecureString "Senha do .pfx"
$imported = Import-PfxCertificate -FilePath $Pfx -CertStoreLocation "Cert:\CurrentUser\My" -Password $password
$password = $null
$thumb = $imported.Thumbprint
try {
  Push-Location $repo
  $builderArgs = @(
    "--filter", "@adr/desktop", "exec", "electron-builder", "--win", "nsis", "--x64",
    "-c.win.signtoolOptions.certificateSha1=$thumb"
  )
  if (-not $CertificadoPublico) { $builderArgs += "-c.win.verifyUpdateCodeSignature=false" }
  & corepack pnpm @builderArgs
  if ($LASTEXITCODE -ne 0) { throw "electron-builder falhou" }
} finally {
  Pop-Location
  Remove-Item -Path ("Cert:\CurrentUser\My\" + $thumb) -DeleteKey -ErrorAction SilentlyContinue
}

$release = Join-Path $repo "apps\desktop\release"
$version = (Get-Content (Join-Path $repo "apps\desktop\package.json") -Raw | ConvertFrom-Json).version
foreach ($file in @(
    (Join-Path $release "win-unpacked\adr-workspace.exe"),
    (Join-Path $release "ADR-Workspace-Setup-$version.exe"))) {
  $sig = Get-AuthenticodeSignature -LiteralPath $file
  Write-Host ("{0}: {1} - {2}" -f (Split-Path $file -Leaf), $sig.Status, $sig.SignerCertificate.Subject)
}
if (-not (Test-Path (Join-Path $release "win-unpacked\adr-workspace.exe.sig"))) {
  Write-Host "ATENCAO: sem assinatura VMP (adr-workspace.exe.sig): o Spotify nao vai tocar."
}
Write-Host "Status 'UnknownError' = assinado, mas este computador ainda nao confia no certificado."
