#!/bin/sh
set -eu
update-alternatives --install /usr/bin/biraworkspace biraworkspace /opt/BiraWorkspace/biraworkspace 100
if [ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ] && command -v apparmor_parser >/dev/null; then
  install -m 0644 /opt/BiraWorkspace/resources/biraworkspace.apparmor /etc/apparmor.d/biraworkspace
  apparmor_parser -r /etc/apparmor.d/biraworkspace
elif ! runuser -u nobody -- unshare -Ur true 2>/dev/null; then
  chmod 4755 /opt/BiraWorkspace/chrome-sandbox
fi
if command -v update-desktop-database >/dev/null; then update-desktop-database /usr/share/applications; fi
