#!/bin/sh
# Run in a disposable Ubuntu graphical test session with a dedicated D-Bus.
set -eu
: "${XDG_CONFIG_HOME:?Defina o perfil descartável de teste}"
test -f "$XDG_CONFIG_HOME/.bira-test-profile"
test "$#" -eq 3
binary=$1
platform=$2
suite=$3
verify="$(dirname "$0")/verify-linux-package.mjs"
export BIRA_TEST_PASSWORD_STORE=gnome-libsecret
printf %s daily-fixture | gnome-keyring-daemon --unlock --components=secrets >/dev/null
case "$suite" in
matrix)
    node "$verify" "$binary" "$platform" seed
    node "$verify" "$binary" "$platform" reopen
    ;;
roundtrip)
    test "$platform" = x11
    openbox > /dev/null 2>&1 &
    wm=$!
    trap 'kill "$wm" 2>/dev/null || true' EXIT
    node "$verify" "$binary" x11 seed
    for action in backup restore; do
        node "$verify" "$binary" x11 "$action"
        # O helper reabre a aplicação pelo executável instalado, sem inspetor.
        # Fechar aquela janela normalmente antes de reabrir com instrumentação.
        i=0
        until wid=$(wmctrl -lp | awk '/ BiraWorkspace$/ {print $1; exit}') && test -n "$wid"; do
            i=$((i+1)); test "$i" -lt 120; sleep .25
        done
        sleep 2
        wmctrl -ic "$wid"
        i=0
        until ! wmctrl -l | grep -q ' BiraWorkspace$'; do
            i=$((i+1)); test "$i" -lt 120; sleep .25
        done
        flock -x "$XDG_CONFIG_HOME/BiraWorkspace.backup.lock" true
    done
    node "$verify" "$binary" x11 reopen
    ;;
*) exit 2 ;;
esac
