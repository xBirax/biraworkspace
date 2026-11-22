# Refinamento 9 — Adaptador Chrome de regressão

> Status: **PASS 100%** com build MV3 0.12.5
>
> Branch: `codex/9-adapter-chrome`

`pnpm --filter @adr/crm-chrome-adapter build` gera `dist-extension/` com:

- `shared.js` bundlado a partir de `@adr/crm-core`
- restante da extensão 0.12.5 (background/content/DOM/CSS/ícones)

Gate: handlers essenciais presentes e versão 0.12.5.
