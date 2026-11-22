# Assinatura de código (Authenticode) — opções gratuitas e o que cada uma resolve

## O problema

O instalador e o `adr-workspace.exe` saem sem assinatura Authenticode. Com isso:

- o **Smart App Control** (Windows 11) pode bloquear o instalador ("não é possível
  confirmar quem publicou");
- o **SmartScreen** mostra "editor desconhecido";
- o electron-updater não tem editor para conferir no instalador da atualização.

A assinatura **VMP da CastLabs** (Widevine/Spotify) é outra coisa e continua sendo
feita no `afterSign` (`apps/desktop/scripts/vmp-sign.cjs`).

## O que existe de graça

| Opção | Custo | Windows confia sozinho? | Serve para o ADR Workspace? |
|---|---|---|---|
| **Certificado autoassinado** (`scripts/assinatura/`) | grátis | **Não** — só nos computadores onde o certificado for instalado como confiável | **Sim**, para os computadores da equipe (implementado) |
| SignPath Foundation | grátis | Sim | **Não**: só para projetos de código aberto (licença OSI, repositório público) |
| Certum "Open Source Code Signing" | ~€ 25–70/ano | Sim | Não é grátis, e é para desenvolvedor de código aberto |
| Azure Artifact Signing (antigo Trusted Signing) | ~US$ 10/mês | Sim | Opção paga mais barata hoje; exige empresa verificável |
| Certificado OV/EV de autoridade comercial | US$ 200–600/ano | Sim (EV ganha reputação mais rápido) | Pago |

Não existe opção gratuita que faça **qualquer** Windows confiar num programa de
código fechado: a confiança de fábrica vem do programa de raízes da Microsoft, e
as autoridades cobram para validar a empresa.

## O que foi implementado (grátis): autoassinado + confiança nos computadores da equipe

```powershell
# 1. Uma vez, na máquina que gera os instaladores (pede uma senha para o .pfx):
powershell -ExecutionPolicy Bypass -File scripts\assinatura\criar-certificado.ps1

# 2. Em cada computador que usa o app, como administrador:
powershell -ExecutionPolicy Bypass -File scripts\assinatura\confiar-certificado.ps1 -Cer "$env:USERPROFILE\.adr-assinatura\adr-codesign.cer"

# 3. Gerar o instalador assinado (pede a senha do .pfx):
powershell -ExecutionPolicy Bypass -File scripts\assinatura\empacotar-assinado.ps1
```

- O `.pfx` (chave privada, cifrado com AES-256) fica em `%USERPROFILE%\.adr-assinatura`,
  **fora do repositório**. Guarde uma cópia num cofre de senhas. Quem o tiver assina
  programas que os computadores da equipe aceitam como confiáveis.
- A senha **não** vai para variável de ambiente nem para linha de comando (com
  `CSC_LINK`/`CSC_KEY_PASSWORD` o electron-builder a repassa ao `signtool /p`,
  visível na lista de processos). O script importa o `.pfx` como não exportável
  só durante o empacotamento, assina pela impressão digital
  (`win.signtoolOptions.certificateSha1`) e remove certificado e chave no fim.
- `confiar-certificado.ps1` instala só em "Raiz Confiável". `-EditoresConfiaveis`
  também instala em "Editores Confiáveis" — evite: isso faz o Windows aceitar sem
  perguntar scripts PowerShell, ClickOnce e macros do Office assinados com a chave.
- O build autoassinado sai com `win.verifyUpdateCodeSignature=false`. Sem isso, o
  atualizador recusaria a atualização em qualquer computador que não confia no
  certificado. **O que isso deixa de proteger:** o sha512 do `latest.yml` vem do
  mesmo lugar que o instalador (o repositório de releases no GitHub), então prova
  que o download chegou inteiro, não quem o publicou. Quem controlar o canal de
  releases consegue distribuir uma atualização — exatamente como hoje, sem
  assinatura. Com certificado de autoridade pública, use `-CertificadoPublico`
  para manter a verificação de editor ligada.
- Ordem: Authenticode no executável → VMP (`afterSign`) → instalador assinado.
- `confiar-certificado.ps1 -Remover` desfaz a confiança.

**Smart App Control:** o SAC confia em certificados do programa de raízes da
Microsoft. Um certificado autoassinado instalado como raiz local pode não ser
aceito por ele: teste num computador com SAC ligado antes de contar com isso.
Enquanto o SAC bloquear, o caminho sem instalador (`corepack pnpm update:local`)
continua funcionando, e o próprio app nunca foi bloqueado.

## Quando houver orçamento

O caminho mais barato com confiança de fábrica é o **Azure Artifact Signing**.
Com OV/EV em arquivo `.pfx`, rode `empacotar-assinado.ps1 -Pfx <arquivo> -CertificadoPublico`,
que mantém a verificação de editor do atualizador ligada. O Azure Artifact Signing
usa o próprio cliente da Microsoft no lugar do `.pfx` (`win.azureSignOptions` no
electron-builder). No CI, a credencial entra como secret, como a da EVS.
