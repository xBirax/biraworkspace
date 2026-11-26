#!/bin/sh
set -eu
case "$1" in remove|purge)
  update-alternatives --remove biraworkspace /opt/BiraWorkspace/biraworkspace
  if [ -f /etc/apparmor.d/biraworkspace ]; then
    if command -v apparmor_parser >/dev/null; then apparmor_parser -R /etc/apparmor.d/biraworkspace || true; fi
    rm -f /etc/apparmor.d/biraworkspace
  fi
esac
