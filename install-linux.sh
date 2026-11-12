#!/usr/bin/env bash
# N1ceOS installer for Linux. Build first:  npm install && npm run pack:linux
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${N1_SRC:-$HERE/dist/linux-unpacked}"
[ -x "$SRC/n1iceos" ] || { echo "Build the app first:  npm install && npm run pack:linux"; exit 1; }

cat <<'TXT'
N1ceOS - a desktop operating system simulation.
A Linux/macOS-style desktop with a window manager, dock, file manager, terminal,
web browser, games and user accounts. It runs as a normal application and does
not change your real system.
TXT
echo
if [ "$(id -u)" -eq 0 ]; then DEF=/opt/N1ceOS; APPS=/usr/share/applications; UHOME="$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)"
else DEF="$HOME/.local/opt/N1ceOS"; APPS="$HOME/.local/share/applications"; UHOME="$HOME"; fi
read -rp "Install directory [$DEF]: " DIR; DIR="${DIR:-$DEF}"
case "$DIR" in /|/usr|/usr/*|/bin|/etc|/home|"$UHOME"|"") echo "Refusing to install into $DIR"; exit 1;; esac
if [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ] && [ ! -x "$DIR/n1iceos" ]; then echo "$DIR is not empty and is not an N1ceOS install. Choose another folder."; exit 1; fi
read -rp "Create an application menu entry? [Y/n] " M; read -rp "Create a Desktop shortcut? [Y/n] " D

mkdir -p "$DIR" && cp -a "$SRC"/. "$DIR"/
[ -f "$HERE/build/icon.png" ] && cp "$HERE/build/icon.png" "$DIR/n1iceos.png"
[ "$(id -u)" -eq 0 ] && [ -f "$DIR/chrome-sandbox" ] && chown root:root "$DIR/chrome-sandbox" && chmod 4755 "$DIR/chrome-sandbox"

ENTRY="[Desktop Entry]
Type=Application
Name=N1ceOS
Comment=Desktop operating system simulation
Exec=\"$DIR/n1iceos\"
Icon=$DIR/n1iceos.png
Terminal=false
Categories=System;Emulator;"
if [ "$(id -u)" -eq 0 ] && [ -n "$SUDO_USER" ]; then DESK="$(sudo -u "$SUDO_USER" xdg-user-dir DESKTOP 2>/dev/null || true)"; else DESK="$(xdg-user-dir DESKTOP 2>/dev/null || true)"; fi
{ [ -z "$DESK" ] || [ "$DESK" = "$UHOME" ]; } && DESK="$UHOME/Desktop"
UN="$DIR/uninstall.sh"
{ echo '#!/usr/bin/env bash'; echo "rm -f \"$APPS/n1iceos.desktop\" \"$DESK/N1ceOS.desktop\""; echo "rm -rf \"$DIR\""; echo 'echo "N1ceOS removed (user data in ~/.config/n1iceos is kept)."'; } > "$UN"; chmod +x "$UN"
if [[ ! "$M" =~ ^[Nn] ]]; then mkdir -p "$APPS"; printf '%s\n' "$ENTRY" > "$APPS/n1iceos.desktop"; chmod +x "$APPS/n1iceos.desktop"; command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" 2>/dev/null || true; fi
if [[ ! "$D" =~ ^[Nn] ]]; then mkdir -p "$DESK"; printf '%s\n' "$ENTRY" > "$DESK/N1ceOS.desktop"; chmod +x "$DESK/N1ceOS.desktop"; [ "$(id -u)" -eq 0 ] && [ -n "$SUDO_USER" ] && chown "$SUDO_USER" "$DESK" "$DESK/N1ceOS.desktop"; command -v gio >/dev/null && gio set "$DESK/N1ceOS.desktop" metadata::trusted true 2>/dev/null || true; fi
echo; echo "Installed to $DIR  (uninstall: $UN)"
