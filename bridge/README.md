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

OrcaSlicer, Creality Print, Elegoo Slicer, Snapmaker Orca and eufyMake Studio take a link from any
address and download it themselves, so Thingport hands them the link directly. When one can't
download from your instance (it doesn't trust the instance's certificate, say), the user can send
it through the Bridge instead: right-click it in Thingport's **Configuration → Slicer** and switch
on **Through Thingport Bridge**.

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

## Update

Download the new version and install it the same way, over the old one. There's nothing to remove first: installing
replaces the old Bridge, and your `config.json` and log stay as they are.

On macOS, installing also quits the Bridge that's running, so the next link opens the new version. Bridge 1.0.1 and
older don't do this. If you're installing one of those, run `killall thingport-bridge` first, or the old version
keeps opening links until you log out.

Thingport tells you when there's a newer one: the first time an older Bridge opens a model after a release, you get a
notification that takes you to the Downloads page, once per version. The Bridge names its version when it downloads
the file, and the instance checks `bridge/package.json` in this repository for the newest.

To see which version you have:

- Windows (PowerShell): `& "$env:LOCALAPPDATA\Thingport\Bridge\thingport-bridge.exe" --version`
- macOS: `~/Applications/Thingport\ Bridge.app/Contents/MacOS/thingport-bridge --version`, or **Get Info** on the app
  in Finder (1.0.1 and older show 1.0 there)
- Linux: `~/.local/bin/thingport-bridge --version`

The newest is on the
[`bridge-latest` release](https://github.com/TautvydasDerzinskas/Thingport/releases/tag/bridge-latest), and what each
version changed is in [CHANGELOG.md](CHANGELOG.md).

## Uninstall

Windows (PowerShell):

```powershell
Remove-Item -Recurse "$env:LOCALAPPDATA\Thingport\Bridge"
Remove-Item -Recurse "HKCU:\Software\Classes\thingport"
```

macOS:

```bash
killall thingport-bridge
rm -rf ~/Applications/Thingport\ Bridge.app
```

Linux:

```bash
rm ~/.local/bin/thingport-bridge ~/.local/share/applications/thingport-bridge.desktop
```

That leaves your settings and log, and the files the Bridge downloaded for your slicers. Delete these folders too if
you want nothing left behind:

| OS      | Settings and log                                 | Downloaded files                    |
| ------- | ------------------------------------------------ | ----------------------------------- |
| Windows | `%APPDATA%\thingport-bridge`                     | `%LOCALAPPDATA%\thingport-bridge`   |
| macOS   | `~/Library/Application Support/thingport-bridge` | `~/Library/Caches/thingport-bridge` |
| Linux   | `~/.config/thingport-bridge`                     | `~/.cache/thingport-bridge`         |

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
- prusaslicer
- cura
- anycubicslicernext (Anycubic Slicer Next -- an OrcaSlicer fork that registers OrcaSlicer's own
  `orcaslicer://` protocol, so it's launched by path to avoid opening OrcaSlicer instead when both
  are installed)
- other (opens with the OS default app)

Only when sent through the Bridge (see above):

- orcaslicer
- crealityprintlink (Creality Print)
- elegooslicer (Elegoo Slicer)
- snapmaker-orca (Snapmaker Orca)
- eufystudio3d (eufyMake Studio)

Cura's AppImage and Flatpak builds aren't on `PATH` and won't be auto-detected. If "Open in Cura"
falls back to opening with your OS default app, add a `cura` entry to `config.json` (see
`config.example.json`) or set `THINGPORT_SLICER_CURA=/path/to/cura`.

Anycubic Slicer Next is looked for as `AnycubicSlicerNext.app` or `Anycubic Slicer Next.app` in
`/Applications` or `~/Applications` on macOS, under Program Files / AppData on Windows, and on `PATH`
on Linux. If yours is elsewhere (e.g. an AppImage), add an `anycubicslicernext` entry to
`config.json` or set `THINGPORT_SLICER_ANYCUBICSLICERNEXT=/path/to/it`.

Where the others are looked for, as their official installers put them:

| Slicer          | Windows                                                                                                                                                                 | macOS                                                                   | Linux (`PATH`, or Flatpak's exported commands)                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| OrcaSlicer      | `Program Files\OrcaSlicer\orca-slicer.exe`                                                                                                                              | `OrcaSlicer.app`                                                        | `orca-slicer`, Flatpak `com.orcaslicer.OrcaSlicer`                                    |
| Creality Print  | `Program Files\Creality\Creality Print <version>\CrealityPrint.exe` (6 and 7), `Program Files\Creality Print <version>\CrealityPrint.exe` (5); the newest version found | `Creality Print.app`                                                    | `CrealityPrint`, `creality-print`, Flatpak `io.github.crealityofficial.CrealityPrint` |
| Elegoo Slicer   | `Program Files\ElegooSlicer\elegoo-slicer.exe`                                                                                                                          | `ElegooSlicer.app`                                                      | `elegoo-slicer`                                                                       |
| Snapmaker Orca  | `Program Files\Snapmaker_Orca\snapmaker-orca.exe`                                                                                                                       | `Snapmaker Orca.app`                                                    | `snapmaker-orca`, Flatpak `io.github.Snapmaker.Snapmaker_Orca`                        |
| eufyMake Studio | `%LOCALAPPDATA%\eufyMake Studio 3D\eufymake studio.exe`, or `AnkerMake Studio` before it was renamed                                                                    | `eufyMake Studio 3D.app`, `eufyMake Studio.app`, `AnkerMake Studio.app` | none (no Linux build)                                                                 |

eufyMake Studio 1.5.26 for Windows installed to `%LOCALAPPDATA%\eufyMake Studio`, which is also
where eufyMake's app for its UV printer goes, so that folder isn't used. With that version, set
`THINGPORT_SLICER_EUFYSTUDIO3D` or add an `eufystudio3d` entry to `config.json`, as for any slicer
installed somewhere else. AppImages are only found once they're on `PATH` under one of the names
above.

On macOS, apps are looked for in both `/Applications` and your own `~/Applications`.

## Testing

After install, paste this into your browser's address bar (replace the URL):
`thingport://open?url=https://example.com/model.3mf&slicer=bambustudio&filename=model.3mf`

## Logs

- Windows: `%APPDATA%\thingport-bridge\bridge.log`
- Linux: `~/.config/thingport-bridge/bridge.log`
- macOS: `~/Library/Application Support/thingport-bridge/bridge.log`

## Notes

- Only model files are fetched: `.stl`, `.3mf`, `.step`, `.stp`, `.obj`, `.glb`, `.gltf`, `.f3d`,
  `.lbrn`, `.lbrn2`, `.gcode` and `.bgcode`. Any website can make a `thingport://` link, and
  anything else could be a program the OS runs when it's opened.
- The download URL carries your Thingport session in its `/api/t/<token>/` path. The log shows it
  as `/api/t/REDACTED/`. Version 1.0.0 wrote it in full, so delete a `bridge.log` it wrote before
  sharing it. Each token in it stops working when it expires: 12 hours after it was issued, unless
  an admin changed that.
- The bridge downloads files into the user cache directory unless configured otherwise.
- If a slicer isn't found, the file opens with the OS default app instead.
- On macOS, the installed app keeps running in the background (no Dock icon) so repeat opens
  don't pay the app-launch cost every time -- this mirrors how macOS delivers custom URL schemes
  to already-registered apps via Apple Events rather than a fresh process per open, unlike
  Windows/Linux.
