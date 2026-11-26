#!/bin/sh
# Integra uma cópia escolhida do AppImage ao Ubuntu 24.04.
set -eu
if [ "$(id -u)" != 0 ] || [ "$#" != 1 ] || [ ! -f "$1" ]; then
  echo "Uso: sudo sh integrar-appimage-ubuntu.sh /caminho/BiraWorkspace.AppImage" >&2; exit 2
fi
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
icon="$script_dir/bira-icon.png"
[ -f "$icon" ] || icon="$script_dir/../apps/desktop/build/icon.png"
[ -f "$icon" ] || { echo 'Coloque bira-icon.png ao lado do instalador.' >&2; exit 2; }
dest=/opt/BiraWorkspace-Portable
install -d -o root -g root -m 0755 "$dest"
install -o root -g root -m 0755 "$1" "$dest/BiraWorkspace.AppImage.new"
mv -f "$dest/BiraWorkspace.AppImage.new" "$dest/BiraWorkspace.AppImage"
if [ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
  cat > /etc/apparmor.d/biraworkspace-portable <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>
/opt/BiraWorkspace-Portable/BiraWorkspace.AppImage flags=(unconfined) {
  userns,
  include if exists <local/biraworkspace-portable>
}
PROFILE
  chmod 0644 /etc/apparmor.d/biraworkspace-portable
  apparmor_parser -r /etc/apparmor.d/biraworkspace-portable
fi
install -m 0644 "$icon" "$dest/icon.png"
install -d -m 0755 /usr/local/share/applications
cat > /usr/local/share/applications/biraworkspace-portable.desktop <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=BiraWorkspace (AppImage)
Exec=/opt/BiraWorkspace-Portable/BiraWorkspace.AppImage %U
Icon=/opt/BiraWorkspace-Portable/icon.png
StartupWMClass=biraworkspace
Categories=Network;
DESKTOP
