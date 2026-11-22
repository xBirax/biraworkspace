# Refinamento 5 — Canal da extensão Chrome

> Status: **artefatos locais PASS · publicação em produção PENDENTE**
>
> Branch: `codex/5-canal-extensao`
>
> Data: 2026-07-22

## Achado

| Fonte | Versão |
|---|---|
| ZIP auditado (`vendor/…` / SHA-256 do plano) | **0.12.5** |
| `update_manifest.xml` ao vivo | **0.12.2** |
| `adr-crm-whatsapp.crx` ao vivo | **0.12.2** |

URL do canal: `https://app.adragencia.com.br/extension-updates/`

App ID: `mmnpdojjfbdjgjgpdmmmilbighjehfee`

## Correção preparada neste repositório

- `extension-updates/update_manifest.xml` → anuncia **0.12.5**
- Runbook: `docs/runbooks/extension-release.md`
- Probe: `scripts/probe-extension-channel.mjs`

## 0.15.1 — autoenvio desligável

A barra CRM do WhatsApp mantém menu de tradução com quatro linhas quando
autoenvio está ligado: traduzir para Espanhol, traduzir para Inglês, alternar
autoenvio e `Desligar autoenvio`. A última ação desliga na conversa atual em
um clique. A versão vendorizada agora é `0.15.1`; o Workspace `0.1.18` anuncia
a mudança no sino e no toast ao abrir.

## 0.15.5 — copiar e-mail, autoenvio por idioma e tradução no Gmail

- **Autoenvio por idioma:** o menu de tradução do WhatsApp lista "Autoenviar em
  Inglês" e "Autoenviar em Espanhol" separados (✓ no ligado; clicar de novo
  desliga), no lugar do item "alternar". `Desligar autoenvio` continua.
- **Copiar e-mail:** mensagem do WhatsApp (recebida ou enviada) com endereço de
  e-mail ganha "📋 copiar e-mail" abaixo do texto, até 3 endereços por mensagem.
  Não depende de login no CRM.
- **Gmail:** o painel "ADR CRM" traduz para português o e-mail recebido aberto
  (a mensagem recebida mais recente da conversa, ou o trecho selecionado), pelo
  mesmo serviço de tradução do WhatsApp (`gmailTranslate`). Até 6.000 caracteres.
  "Sua" mensagem é reconhecida pelo e-mail da conta no título da aba; quem responde
  por alias ("Enviar como") pode ver a própria resposta escolhida — o status diz de
  quem é a mensagem e "Traduzir mensagem anterior" recua uma por clique.
- **Handoff ao CRM:** `adrCrm.openCrm({path})` só aceita `/negocios` com parâmetros
  `vincular*` (`isCrmHandoffPath`); rota nova de handoff precisa entrar na lista.
- `titleParts` passou a separar pessoa/empresa no hífen só com espaço dos dois
  lados ("Ana-Maria Souza" é um nome), igual no `shared.js` e no `crm-core`.

## Gate do plano mestre

> “versão publicada e arquivo servido correspondem”

Isso só fecha a **100%** depois de publicar atomicamente no site ADR (Vercel):

1. CRX assinado 0.12.5
2. `update_manifest.xml` 0.12.5
3. Probe ao vivo PASS

Enquanto isso, o gate local deste monorepo passa quando:

- discrepância está documentada
- manifesto corrigido existe
- ZIP vendor é 0.12.5
- probe detecta o mismatch ao vivo (prova do bug)

## Checklist

- [x] Discrepância 0.12.5 vs 0.12.2 confirmada no canal ao vivo
- [x] Manifesto corrigido commitado
- [x] Runbook de release atômico
- [ ] Deploy produção (fora deste repo até o pacote CRX 0.12.5 ser publicado)
