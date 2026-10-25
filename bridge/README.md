# Thingport Bridge

This helper registers the custom protocol `thingport://`, downloads the requested file, and
launches it in the slicer Thingport asked for. It exists because some slicers' own URL protocol
handlers won't take a link straight from a self-hosted Thingport instance:

- Bambu Studio's `bambustudio://` and PrusaSlicer's `prusaslicer://` both only accept links from a
  domain allowlist (Bambu Lab's own storefronts; printables.com plus a handful of sites Prusa has
  manually whitelisted, respectively) that a self-hosted instance is never on, so "Open in
  {Slicer}" would otherwise silently do nothing.
- Cura's `cura://open` handler isn't domain-restricted, but its OS protocol registration is
  unreliable across its AppImage/Flatpak/Microsoft Store builds, so it's routed the same way for
  consistency.
- Anycubic Slicer Next is an OrcaSlicer fork that handles the same links, but it registers
  OrcaSlicer's own `orcaslicer://` protocol instead of one of its own -- with both installed, only
  one of them gets those links. The Bridge launches it by path, so the slicer you picked opens.

OrcaSlicer's protocol handler accepts any HTTP(S) URL directly with no such restriction, so it's
launched straight from the browser and never needs this bridge.

Protocol format:
`thingport://open?url=<download-url>&slicer=<id>&filename=<name>`

The `url` parameter should be a direct HTTP(s) download link. Thingport already includes the
auth token in that URL.

## Quick install (no shell commands)

Download the latest Bridge binary for your OS from the
[`bridge-latest` release](https://github.com/TautvydasDerzinskas/Thingport/releases/tag/bridge-latest)
(also linked from the in-app Download page) and run it once. Each build has its own version
(`thingport-bridge --version`; changes in [CHANGELOG.md](CHANGELOG.md)). Running it registers the
`thingport://` protocol handler and copies the binary into a stable location:

- Windows: `%LOCALAPPDATA%\Thingport\Bridge\thingport-bridge.exe`
- Linux: `~/.local/bin/thingport-bridge`
- macOS: `~/Applications/Thingport Bridge.app`

### Windows / Linux

Double-click the downloaded file (or run it with no arguments from a terminal). If your Linux
file manager blocks execution, mark the file as executable first (`chmod +x`) and run it once.

### macOS

macOS only recognizes a real `.app` bundle as a protocol handler, so install here is an explicit
step rather than a plain double-click:

```bash
chmod +x ~/Downloads/thingport-bridge-macos
xattr -d com.apple.quarantine ~/Downloads/thingport-bridge-macos # downloaded files are quarantined by Gatekeeper
~/Downloads/thingport-bridge-macos --install
```

This copies itself into `~/Applications/Thingport Bridge.app` (a background, Dock-less agent)
and registers the `thingport://` scheme with Launch Services. If macOS still refuses to run it,
open System Settings -> Privacy & Security and allow it there instead of using `xattr`.

If the terminal instead prints `Killed: 9` (or `[1] ... killed`) the moment you run it, that's a
stale, invalidly-signed binary rather than a Gatekeeper block -- re-sign it yourself and retry:

```bash
codesign --force -s - ~/Downloads/thingport-bridge-macos
```

## Build

You need Go installed (1.21+ recommended). macOS builds also need Xcode's command line tools
(`xcode-select --install`) since the URL-open handling uses Cocoa via cgo, and can only be built
on macOS itself.

Windows (PowerShell):

```powershell
cd bridge
go build -o dist\thingport-bridge.exe .\cmd\thingport-bridge
```

Linux (bash):

```bash
cd bridge
go build -o dist/thingport-bridge ./cmd/thingport-bridge
```

macOS (bash), universal binary:

```bash
cd bridge
GOARCH=arm64 go build -o dist/thingport-bridge-arm64 ./cmd/thingport-bridge
GOARCH=amd64 go build -o dist/thingport-bridge-amd64 ./cmd/thingport-bridge
lipo -create -output dist/thingport-bridge-macos dist/thingport-bridge-arm64 dist/thingport-bridge-amd64
codesign --force -s - dist/thingport-bridge-macos # lipo invalidates each slice's signature;
# without this, arm64 Macs SIGKILL it on launch
```

## Install (manual)

Windows (PowerShell):

```powershell
cd bridge\scripts
.\install-windows.ps1 -BridgePath "..\dist\thingport-bridge.exe"
```

Linux (bash):

```bash
cd bridge/scripts
./install-linux.sh ../dist/thingport-bridge
```

You can also run the binary directly: `thingport-bridge --install` (this is required, not just
convenient, on macOS -- see above).

If your shell blocks scripts, set the execution policy for the current user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## Auto-start at login (optional)

Not needed on any OS for correctness -- see "Quick install" above: Windows and Linux launch the
Bridge fresh, URL already attached, from the registered protocol handler on every click, and
macOS launches its app bundle on demand the same way, even after a reboot. There is nothing
sitting idle waiting to be started.

The only thing adding it as a login item buys you is skipping the ~1 second app-launch delay on
the very first click after starting up your Mac (Windows/Linux have no such delay to skip, since
each click is already a fresh, near-instant process start -- there's no persistent process to
pre-warm).

If you still want it, on macOS:

**Easiest** -- System Settings -> General -> Login Items & Extensions -> click **+** and add
`Thingport Bridge` from `~/Applications`.

**Or, a LaunchAgent** -- save as `~/Library/LaunchAgents/com.thingport.bridge.plist` (replace
`YOUR_USERNAME`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.thingport.bridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/YOUR_USERNAME/Applications/Thingport Bridge.app/Contents/MacOS/thingport-bridge</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

then:

```bash
mkdir -p ~/Library/LaunchAgents
# save the file above as ~/Library/LaunchAgents/com.thingport.bridge.plist
launchctl load ~/Library/LaunchAgents/com.thingport.bridge.plist
```

## Config

Create a config file if you want custom slicer paths or arguments:

- Windows: `%APPDATA%\thingport-bridge\config.json`
- Linux: `~/.config/thingport-bridge/config.json`
- macOS: `~/Library/Application Support/thingport-bridge/config.json`

Use `config.example.json` as a template.

Environment override (per slicer): `THINGPORT_SLICER_BAMBUSTUDIO=/path/to/BambuStudio`

## Slicer IDs

- bambustudio
- orcaslicer (not actually routed through the Bridge -- see above -- but still a valid `slicer=`
  value and `config.json`/env-var override key)
- prusaslicer
- cura
- anycubicslicernext (Anycubic Slicer Next -- an OrcaSlicer fork that registers OrcaSlicer's own
  `orcaslicer://` protocol, so it's launched by path to avoid opening OrcaSlicer instead when both
  are installed)
- other (opens with the OS default app)

Cura's AppImage and Flatpak builds aren't on `PATH` and won't be auto-detected. If "Open in Cura"
falls back to opening with your OS default app, add a `cura` entry to `config.json` (see
`config.example.json`) or set `THINGPORT_SLICER_CURA=/path/to/cura`.

Anycubic Slicer Next is looked for as `AnycubicSlicerNext.app` or `Anycubic Slicer Next.app` in
`/Applications` or `~/Applications` on macOS, under Program Files / AppData on Windows, and on `PATH`
on Linux. If yours is elsewhere (e.g. an AppImage), add an `anycubicslicernext` entry to
`config.json` or set `THINGPORT_SLICER_ANYCUBICSLICERNEXT=/path/to/it`.

On macOS, apps are looked for in both `/Applications` and your own `~/Applications`.

## Testing

After install, paste this into your browser's address bar (replace the URL):
`thingport://open?url=https://example.com/model.3mf&slicer=bambustudio&filename=model.3mf`

## Logs

- Windows: `%APPDATA%\thingport-bridge\bridge.log`
- Linux: `~/.config/thingport-bridge/bridge.log`
- macOS: `~/Library/Application Support/thingport-bridge/bridge.log`

## Notes

- The bridge downloads files into the user cache directory unless configured otherwise.
- If a slicer isn't found, the file opens with the OS default app instead.
- On macOS, the installed app keeps running in the background (no Dock icon) so repeat opens
  don't pay the app-launch cost every time -- this mirrors how macOS delivers custom URL schemes
  to already-registered apps via Apple Events rather than a fresh process per open, unlike
  Windows/Linux.
