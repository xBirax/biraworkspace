# Evidência de release Windows — 0.1.49

Data: 09/10/2026. Responsável pela aprovação: usuário responsável pelo projeto.

## Confirmação de uso real

Foi solicitada a confirmação do roteiro de `docs/windows-release-smoke.md`,
incluindo instalação limpa, atualização com sessões autenticadas no Windows e
clique na notificação do WhatsApp. O responsável respondeu:

> Já foi realizado e aprovado

Essa é a confirmação do responsável; os cenários com contas reais não foram
observados independentemente pelo agente. Ela autoriza o despacho de publicação
estável previsto no workflow, após o build da tag concluir com sucesso.

## Verificações automatizadas

O workflow da tag executa build, typecheck, lint, testes dos pacotes, testes do
helper nativo e fixtures Electron antes de gerar o instalador assinado com VMP.
A fixture específica de notificações cobre a seleção exata da conversa, os
eventos de mouse, a renderização atrasada, a busca lateral e o encaminhamento
ao processo principal antes da navegação. Testes do processo principal verificam
a exigência/cancelamento do PIN e o bloqueio do CRM com permissões antigas.

O despacho estável deve usar o artefato do push da própria tag `v0.1.49`, no
mesmo commit, sem recompilação.
