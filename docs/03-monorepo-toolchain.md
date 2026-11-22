# Refinamento 3 — Monorepo e toolchain

> Status: **gate fechado quando install/typecheck/test/build passam**
>
> Branch: `codex/3-monorepo-toolchain`
>
> Data: 2026-07-22

## Objetivo

Clone limpo executa install, typecheck e testes com TypeScript `strict`, ESLint, Prettier, Vitest e pnpm workspaces.

## Pacotes

| Path | Pacote | Papel |
|---|---|---|
| `apps/desktop` | `@adr/desktop` | Shell Electron (placeholder) |
| `packages/contracts` | `@adr/contracts` | Tipos compartilhados |
| `packages/crm-core` | `@adr/crm-core` | Regras puras sem chrome/electron/DOM |
| `packages/crm-whatsapp-ui` | `@adr/crm-whatsapp-ui` | UI DOM (placeholder) |
| `packages/crm-chrome-adapter` | `@adr/crm-chrome-adapter` | Adapter MV3 (placeholder) |
| `packages/crm-desktop-adapter` | `@adr/crm-desktop-adapter` | Adapter Electron (placeholder) |
| `packages/service-adapters` | `@adr/service-adapters` | Serviços (placeholder) |

## Toolchain

- pnpm `9.15.9` (Corepack)
- TypeScript `strict` + `noUncheckedIndexedAccess`
- ESLint flat config + typescript-eslint
- Prettier
- Vitest

## Vendor

Extensão `0.12.5` vendorizada em `vendor/adr-crm-extension-0.12.5` com SHA-256 em `vendor/adr-crm-extension-0.12.5.sha256`.

## Comandos do gate

O `build` vem **antes** do `typecheck`, e a ordem não é estética: `dist/` é gitignored e
cada pacote resolve o irmão por `exports -> ./dist/index.d.ts`. Num clone limpo, sem build,
o `typecheck` não acha `@adr/contracts` e para em `TS2307` — o que passa despercebido na
máquina de quem já rodou `pnpm dev` alguma vez, porque lá o `dist` sobrou.

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
node scripts/verify-refinement-03.mjs
```

## Checklist

- [x] pnpm workspaces
- [x] TypeScript strict
- [x] lint (ESLint)
- [x] testes (Vitest)
- [x] build determinístico por pacote
- [x] estrutura do plano mestre criada
