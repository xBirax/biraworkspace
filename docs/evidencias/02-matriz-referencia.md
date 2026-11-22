# Evidência — Refinamento 2

Data: 2026-07-22  
Branch: `codex/2-matriz-referencia`  
Host: `bira-960XFH`

## Entregáveis

1. `docs/02-matriz-referencia.md` — matriz Ubuntu/Wayland/X11/RAM/Chrome/Brave
2. `scripts/collect-reference-matrix.mjs` — coleta reproduzível
3. `scripts/verify-refinement-02.mjs` — gate automático
4. `docs/evidencias/02-host-atual.matrix.json` — amostra do host atual

## Resultado do probe (host atual)

| Tag | Valor |
|---|---|
| ubuntu2604 | true |
| ubuntu2404 | false (REQUIRED em VM) |
| wayland | true |
| x11 | false (REQUIRED em VM/sessão X11) |
| ram32class | true (30,4 GiB) |
| chromePresent | true |
| braveAbsent | true |

## Comandos

```bash
node scripts/collect-reference-matrix.mjs
node scripts/verify-refinement-02.mjs
```

## Gate

Matriz documentada e reproduzível por outra máquina/VM via script único.
Células 24.04 e X11 ficam como REQUIRED para o smoke da release, não para este gate.

## Próximo passo

Refinamento 3 — criar monorepo e toolchain (pnpm, TypeScript strict, lint, testes, builds).
