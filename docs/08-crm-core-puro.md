# Refinamento 8 — Separar código puro do Chrome

> Status: **PASS 100%** quando `crm-core` não importa chrome/electron/DOM
>
> Branch: `codex/8-crm-core-puro` (mesmo trabalho contínuo após R7)

Portados de `shared.js` / `background.js`:

- `normalizeAllowedBaseUrl`
- transcript cache
- `chatKey` / composer normalize
- scoring/desambiguação de lookup
