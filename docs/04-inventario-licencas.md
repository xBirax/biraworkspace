# Refinamento 4 — Inventário de dependências e licenças

> Status: **PASS 100%**
>
> Branch: `codex/4-inventario-licencas`
>
> Data: 2026-07-22

## Objetivo

Classificar licenças permissivas, GPL e comerciais. Nenhuma biblioteca incompatível ou paga.

## Resultado

| Métrica | Valor |
|---|---:|
| Pacotes inventariados | 151 |
| Issues bloqueantes (GPL/comercial) | 0 |
| Issues para revisão | 0 |

### Distribuição

| Licença | Qtd | Classe |
|---|---:|---|
| MIT | 120 | permissiva |
| Apache-2.0 | 13 | permissiva |
| ISC | 8 | permissiva |
| BSD-2-Clause | 6 | permissiva |
| BSD-3-Clause | 2 | permissiva |
| BlueOak-1.0.0 | 1 | permissiva |
| Python-2.0 | 1 | permissiva |

## Política permanente

Bloquear na CI / gate de release:

- GPL, AGPL, LGPL, SSPL, OSL, EUPL (copyleft forte)
- Licenças comerciais / proprietárias / BUSL
- Pacote `electron-chrome-extensions` (já rejeitado no plano mestre)

Permitir: MIT, Apache-2.0, BSD-*, ISC, 0BSD, BlueOak-1.0.0, Unlicense, CC0-1.0, Python-2.0.

### Exceções aprovadas (copyleft fraco, por arquivo)

| Pacote | Licença | Uso | Condição |
|---|---|---|---|
| `ical.js` 2.2.1 (Mozilla) | MPL-2.0 | Lembrete de reunião: ler o iCal do Google Calendar (`apps/desktop/src/main/calendar-reminders.ts`) | Usado sem modificação. A MPL-2.0 obriga a disponibilizar o código-fonte só dos arquivos da biblioteca que forem ALTERADOS; não contamina o código do app. Se um dia for alterado, publicar os arquivos alterados. |

Se a política preferir só permissivas, a alternativa é trocar por um parser
próprio de iCal com RRULE — mais código e mais risco de lembrete errado.

## Evidências

- `docs/evidencias/04-pnpm-licenses.raw.json`
- `docs/evidencias/04-license-inventory.json`

## Comando

```bash
node scripts/verify-refinement-04.mjs
```

## Checklist

- [x] Inventário gerado a partir do lockfile
- [x] Classificação permissiva / copyleft / comercial
- [x] Zero dependências incompatíveis ou pagas
- [x] Política documentada para próximos PRs
