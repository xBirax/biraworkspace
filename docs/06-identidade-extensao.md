# Refinamento 6 — Identidade da extensão

> Status: **PASS com ressalva da chave privada**
>
> Branch: `codex/6-identidade-extensao`
>
> Data: 2026-07-22

## Identidade confirmada

| Campo | Valor |
|---|---|
| Extension ID | `mmnpdojjfbdjgjgpdmmmilbighjehfee` |
| Fonte | CRX publicado (header CRX3 → SPKI → SHA-256 → id) |
| Verificação | `node scripts/verify-extension-id.mjs <crx>` → match |

A chave **pública** está embutida no CRX ao vivo e reproduz o ID esperado.

## Chave privada

- **Não** está no ZIP `0.12.5` vendorizado.
- **Não** deve ser commitada neste repositório.
- Local obrigatório (segredo operacional): cofre da ADR / secret store, fora do git.

Sem a privada, novos CRX assinado com o **mesmo** ID não podem ser gerados aqui.

## Política de migração (se a privada estiver perdida)

1. Gerar novo par de chaves.
2. Documentar o novo Extension ID.
3. Publicar instalador one-shot / política Linux pedindo reinstalação única.
4. Manter o canal antigo congelado ou redirecionado com notas.
5. Registrar a troca em ADR técnica.

Enquanto a privada existir no cofre, **não** gerar nova identidade.

## Checklist

- [x] ID `mmnpdojjfbdjgjgpdmmmilbighjehfee` verificado a partir do CRX
- [x] Ausência da privada no vendor documentada
- [x] Política de reinstalação única definida se a privada não aparecer
- [ ] Chave privada localizada no cofre operacional (ação humana fora do git)
