# Refinamento 13 — Estado versionado

`@adr/app-state`: `AppStateV1` + Zod + escrita atômica (`tmp` → `fsync` → rename) + backup `.bak` + permissão `0600`.

Gate: estado truncado recupera o último backup válido.
