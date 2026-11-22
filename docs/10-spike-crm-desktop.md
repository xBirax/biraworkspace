# Refinamento 10 — Spike CRM desktop

> Status: **fundação PASS · gate .deb interativo PENDENTE de login humano**
>
> Branch: `codex/10-spike-crm-desktop`

## Implementado

- `BaseWindow` + `WebContentsView` (sem BrowserView/webview)
- Partições isoladas `persist:wa-*` e `persist:crm-*`
- Preload CRM isolado (`contextBridge`) só na view WhatsApp
- IPC tipado com guard de origem (`@adr/crm-desktop-adapter`)
- Comandos do spike: `whoami`, `lookup`, `getChatIdentity`
- Probe de conversa portado (função fixa, sem JS arbitrário via IPC)
- Tokens lidos só no main a partir da partição CRM

## Gate do plano

As três operações precisam funcionar no `.deb`. Isso exige:

1. Login CRM na partição CRM
2. QR/login WhatsApp
3. Conta/autorização reais

Automatizado agora:

```bash
pnpm --filter @adr/crm-desktop-adapter test
pnpm --filter @adr/desktop build
pnpm --filter @adr/desktop test
```

Empacote:

```bash
pnpm --filter @adr/desktop pack:deb
```
