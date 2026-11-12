# N1ceOS

N1ceOS is a desktop operating system simulation: a Linux/macOS-style desktop with a window manager, dock,
file manager, terminal, web browser, games, user accounts and more. It runs as a normal application
(built with Electron, HTML, CSS and JavaScript) and does not change your real system.

**Developer:** Cr1sN1ce · **Version:** 1.0

## Features
- Desktop, top panel, dock, draggable/resizable windows, themes, accent colors, custom wallpapers
- Apps: Files, Terminal, Text Editor, Calculator, System Monitor, Settings, N1ce Browser (real Chromium tabs),
  App Store with Paint, Notes+, Weather, Music (Spotify), Clock, N1ce Chess, N1ce Air Hockey and installable sandboxed packages
- User accounts with Argon2-class password hashing (scrypt), per-user home folders, `deluser` command, account deletion

## Requirements
- Node.js 18 or newer and an internet connection (npm packages, and the UI libraries load from CDNs on start)

## Run from source
```
npm install
npm start
```

## Windows installer
Build (run the console as Administrator, or enable *Developer Mode* in Windows settings):
```
npm install
npm run dist
```
The installer is created at `dist\N1ceOS-Setup-1.0.0.exe`. Run it to:
- choose the install folder (default `C:\Program Files\N1ceOS`),
- read a short description and choose Start menu / Desktop shortcuts.

The installer copies `N1ceOS.exe` with all required DLLs and resources into the chosen folder.
Uninstall from *Settings → Apps*; user accounts and data in `%APPDATA%` are kept.

## Linux installer
Build the app, then run the installer script:
```
npm install
npm run pack:linux
bash install-linux.sh
```
The script shows the description, asks for the install folder (default `~/.local/opt/N1ceOS`, or `/opt/N1ceOS`
when run as root) and offers an application-menu entry and a Desktop shortcut. It also creates
`uninstall.sh` inside the install folder.

Alternatively build ready-made packages (on Fedora first run `sudo dnf install rpm-build`):
```
npm run dist:linux            # AppImage, .deb and .rpm in dist/
sudo dnf install dist/*.rpm   # Fedora
```

## Where your data is stored
- Windows: `%APPDATA%\n1iceos`  ·  Linux: `~/.config/n1iceos`
- Each user has a separate folder; deleting an account removes that folder.

## Tests
```
npm test
```
Runs the user-management tests (account creation, login, isolation, `deluser`, path traversal, downloads).

## Project structure
| Path | Purpose |
|---|---|
| `main.js`, `preload.js` | Electron main process and secure IPC bridge |
| `users.js` | User management service (accounts, per-user storage, deletion) |
| `renderer/index.html` | The N1ceOS desktop UI and apps |
| `build/` | Icons and the Windows installer script (`installer.nsh`) |
| `install-linux.sh` | Linux installer script |
| `test/` | Automated tests |

## Notes
- Spotify playback inside Electron may be limited (no DRM support); use the external web player button if needed.
- Installers are not code-signed, so Windows SmartScreen may show a warning.
