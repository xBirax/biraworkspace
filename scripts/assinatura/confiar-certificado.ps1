# ADR Workspace - marca o certificado autoassinado como confiavel NESTE computador.
#
# Precisa de administrador: instala o certificado publico (.cer) em
# "Autoridades de Certificacao Raiz Confiaveis" da maquina. Depois disso o
# Windows mostra "ADR Agencia" como editor do app e do instalador, com
# assinatura valida.
#
# -EditoresConfiaveis tambem o poe em "Editores Confiaveis". So use se precisar:
# alem de programas, isso faz o Windows aceitar SEM PERGUNTAR scripts PowerShell
# assinados (politicas AllSigned/RemoteSigned), ClickOnce e macros do Office sob
# politica de editor confiavel assinados com esta chave.
#
# Isto e uma decisao de seguranca do dono do computador: quem tiver a chave
# privada (.pfx) passa a poder assinar programas que esta maquina considera
# confiaveis. Guarde o .pfx num cofre. Para desfazer: -Remover.
#
# Uso (PowerShell como administrador):
#   powershell -ExecutionPolicy Bypass -File confiar-certificado.ps1 -Cer C:\caminho\adr-codesign.cer
#   powershell -ExecutionPolicy Bypass -File confiar-certificado.ps1 -Cer C:\caminho\adr-codesign.cer -Remover
param(
  [Parameter(Mandatory = $true)][string]$Cer,
  [switch]$EditoresConfiaveis,
  [switch]$Remover
)
$ErrorActionPreference = "Stop"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Abra o PowerShell como administrador e rode de novo."
  exit 1
}
$cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2((Resolve-Path -LiteralPath $Cer).Path)
if ($cert.HasPrivateKey) { Write-Host "Use o .cer (publico), nunca o .pfx."; exit 1 }

# Remover tira dos dois, para desfazer qualquer instalacao anterior.
$stores = if ($Remover -or $EditoresConfiaveis) { @("Root", "TrustedPublisher") } else { @("Root") }
foreach ($store in $stores) {
  $path = "Cert:\LocalMachine\$store\$($cert.Thumbprint)"
  if ($Remover) {
    if (Test-Path $path) { Remove-Item $path -Force; Write-Host "Removido de LocalMachine\$store" }
  } elseif (-not (Test-Path $path)) {
    Import-Certificate -FilePath $Cer -CertStoreLocation "Cert:\LocalMachine\$store" | Out-Null
    Write-Host "Instalado em LocalMachine\$store"
  } else {
    Write-Host "Ja estava em LocalMachine\$store"
  }
}
Write-Host "Certificado: $($cert.Subject)  ($($cert.Thumbprint))"
