#!/bin/bash
# Mede RAM do ADR Workspace com perfil temporário e CRM simulado (ver README.md ao lado).
# Uso (Git Bash, na raiz do repo, depois de `corepack pnpm build`):
#   bash scripts/measure-ram/run.sh <rotulo> [run|ui]
# Rótulo: nome livre da rodada (ex.: base, depois). Resultado: $WORK/result-<rotulo>-<modo>.json
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${WORK:-$ROOT/../adr-measure}"
LABEL="${1:?rótulo}"; MODE="${2:-run}"
[[ "$LABEL" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo 'Rótulo inválido'; exit 1; }
[[ "$MODE" =~ ^(run|ui|verify)$ ]] || { echo 'Modo inválido'; exit 1; }
E="$ROOT/apps/desktop/node_modules/electron/dist/electron.exe"
mkdir -p "$WORK"
cd "$WORK"
[ -f key.pem ] || MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 30 -subj "/CN=app.adragencia.com.br" 2>/dev/null
# O app resolve shell/ e ../../vendor a partir da pasta do script: o build fica em
# $WORK/apps/<rotulo>, e ../../vendor cai em $WORK/vendor.
A="$WORK/apps/$LABEL"
rm -rf "$A" && mkdir -p "$A" && cp -r "$ROOT/apps/desktop/dist" "$A/dist"
cp "$ROOT/scripts/measure-ram/measure.cjs" "$ROOT/scripts/measure-ram/verify.cjs" key.pem cert.pem "$A/"
cp "$ROOT/packages/view-lifecycle/dist/media-active.js" "$A/media-probe.mjs"
[ -d vendor ] || cp -r "$ROOT/vendor" vendor
# Perfil semeado uma vez (workspace "Principal" + "B", CRM logado no simulador) e copiado a cada rodada.
if [ ! -d "profile-seed Dev" ]; then
  mkdir -p profile-seed
  (cd "$A" && timeout 150 "$E" measure.cjs seed "$WORK/profile-seed" "$WORK/seed.txt" "$A/dist/main/index.bundle.cjs" > "$WORK/seed.log" 2>&1)
fi
P="$WORK/profile-$LABEL-$MODE"
rm -rf "$P" "$P Dev"; mkdir -p "$P"; cp -r "$WORK/profile-seed Dev" "$P Dev"
(cd "$A" && timeout 600 "$E" measure.cjs "$MODE" "$P" "$WORK/result-$LABEL-$MODE.json" "$A/dist/main/index.bundle.cjs" > "$WORK/run-$LABEL-$MODE.log" 2>&1)
cat "$WORK/result-$LABEL-$MODE.json"
