# ADR Workspace - certificado de assinatura de codigo AUTOASSINADO (gratuito).
#
# O que ele resolve: o executavel e o instalador passam a ter assinatura
# Authenticode com o editor "ADR Agencia". Em cada computador onde o
# certificado for marcado como confiavel (confiar-certificado.ps1), o Windows
# mostra o editor e a assinatura como valida.
#
# O que ele NAO resolve: computador que nao confia no certificado ve o arquivo
# como de editor desconhecido, igual a hoje. O SmartScreen e o Smart App
# Control so confiam de fabrica em certificados de uma autoridade do programa
# de raizes da Microsoft - isso nao existe gratis para app de codigo fechado.
# Ver docs/ASSINATURA.md.
#
# Uso (uma vez, na maquina que gera os instaladores):
#   powershell -ExecutionPolicy Bypass -File scripts\assinatura\criar-certificado.ps1
#
# Gera em %USERPROFILE%\.adr-assinatura:
#   adr-codesign.pfx  - chave privada + certificado, protegido por senha (AES-256).
#                       NUNCA no repositorio; guarde uma copia num cofre de senhas.
#   adr-codesign.cer  - so o certificado publico, para confiar nas maquinas.
param(
  [string]$Subject = "CN=ADR Agencia, O=ADR Agencia, C=BR",
  [int]$Years = 5,
  [string]$OutDir = (Join-Path $env:USERPROFILE ".adr-assinatura")
)
$ErrorActionPreference = "Stop"

$pfx = Join-Path $OutDir "adr-codesign.pfx"
$cer = Join-Path $OutDir "adr-codesign.cer"
if (Test-Path -LiteralPath $pfx) {
  Write-Host "Ja existe $pfx. Apague-o (e o .cer) se quiser gerar outro: instaladores ja"
  Write-Host "assinados continuam validos so com o certificado antigo instalado."
  exit 1
}
New-Item -ItemType Directory -Force $OutDir | Out-Null

$password = Read-Host -AsSecureString "Senha para proteger o .pfx (guarde-a no cofre de senhas)"
$confirm = Read-Host -AsSecureString "Repita a senha"
$plain1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))
$plain2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm))
if (-not $plain1 -or $plain1 -ne $plain2) { Write-Host "As senhas nao conferem."; exit 1 }
$plain1 = $null
$plain2 = $null

# Gerado no repositorio pessoal do usuario so para exportar; removido em seguida
# (com a chave) para nao ficar uma chave de assinatura solta no Windows.
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $Subject `
  -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable -KeyUsage DigitalSignature `
  -CertStoreLocation "Cert:\CurrentUser\My" -NotAfter (Get-Date).AddYears($Years)
try {
  # AES-256: o padrao do PowerShell 5.1 ainda e 3DES/SHA1.
  Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $password -CryptoAlgorithmOption AES256_SHA256 | Out-Null
  Export-Certificate -Cert $cert -FilePath $cer | Out-Null
} finally {
  # -DeleteKey: sem ele sai so o certificado, e a chave privada fica no
  # repositorio de chaves do usuario, protegida so pelo login do Windows.
  Remove-Item -Path ("Cert:\CurrentUser\My\" + $cert.Thumbprint) -DeleteKey -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Certificado criado:"
Write-Host "  $pfx  (privado - nao versionar)"
Write-Host "  $cer  (publico - para confiar nas maquinas)"
Write-Host "  Impressao digital: $($cert.Thumbprint)"
Write-Host ""
Write-Host "Proximos passos:"
Write-Host "  1. Em cada computador que vai usar o app (como administrador):"
Write-Host "     powershell -ExecutionPolicy Bypass -File scripts\assinatura\confiar-certificado.ps1 -Cer `"$cer`""
Write-Host "     (o .cer pode ir por e-mail ou pasta compartilhada; o .pfx NUNCA)"
Write-Host "  2. Para gerar o instalador assinado:"
Write-Host "     powershell -ExecutionPolicy Bypass -File scripts\assinatura\empacotar-assinado.ps1"
