# Runbook — release atômico da extensão ADR CRM

## Regra

Nunca publicar o CRX sem atualizar o `update_manifest.xml` na mesma promoção, e vice-versa.
Versão do `manifest.json` dentro do CRX === versão no XML === tag/release notes.

## Passos

1. Build a partir da pasta `vendor/adr-crm-extension-<versão>` mais nova (ou pacotes reconstruídos no monorepo).
2. Assinar o CRX com a chave que produz `mmnpdojjfbdjgjgpdmmmilbighjehfee` (ver refinamento 6).
3. Atualizar `extension-updates/update_manifest.xml` com a mesma versão.
4. Publicar ambos no site `app.adragencia.com.br/extension-updates/` na mesma deploy.
5. Rodar:

```bash
node scripts/probe-extension-channel.mjs --expect <versão>
```

6. Só então marcar o canal como saudável.

## Rollback

Republish o par XML+CRX da versão anterior juntos.
