//go:build darwin

package main

/*
#include <stdlib.h>

int TPQuitOtherBridges(const char *bundleID, double graceSeconds);
*/
import "C"

import (
	_ "embed"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"unsafe"
)

const (
	bundleName     = "Thingport Bridge.app"
	bundleID       = "com.thingport.bridge"
	bundleExeName  = "thingport-bridge"
	bundleIconName = "AppIcon.icns"
	lsregisterBin  = "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
)

//go:embed thingport.icns
var bundleIcon []byte

// macOS only honors URL schemes declared by an .app bundle's Info.plist, so install builds a
// bundle under ~/Applications and registers it.
func installSelf() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve executable: %w", err)
	}
	exePath, err = filepath.EvalSymlinks(exePath)
	if err != nil {
		return "", fmt.Errorf("resolve executable: %w", err)
	}

	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return "", fmt.Errorf("resolve home dir: %w", err)
	}

	appDir := filepath.Join(home, "Applications", bundleName)
	contentsDir := filepath.Join(appDir, "Contents")
	macosDir := filepath.Join(contentsDir, "MacOS")
	resourcesDir := filepath.Join(contentsDir, "Resources")
	targetExe := filepath.Join(macosDir, bundleExeName)

	if !samePath(exePath, targetExe) {
		if err := replaceFile(exePath, targetExe, 0755); err != nil {
			return "", fmt.Errorf("copy binary: %w", err)
		}
	} else if err := os.Chmod(targetExe, 0755); err != nil {
		return "", fmt.Errorf("set permissions: %w", err)
	}

	if err := os.WriteFile(filepath.Join(contentsDir, "Info.plist"), []byte(infoPlist()), 0644); err != nil {
		return "", fmt.Errorf("write Info.plist: %w", err)
	}

	// LSUIElement apps need CFBundleIconFile. Embedded so the single binary is enough to install.
	if err := os.MkdirAll(resourcesDir, 0755); err != nil {
		return "", fmt.Errorf("create Resources dir: %w", err)
	}
	if err := os.WriteFile(filepath.Join(resourcesDir, bundleIconName), bundleIcon, 0644); err != nil {
		return "", fmt.Errorf("write app icon: %w", err)
	}

	// Best-effort: registration also happens on the periodic system rescan.
	if _, err := os.Stat(lsregisterBin); err == nil {
		_ = exec.Command(lsregisterBin, "-f", appDir).Run()
	}

	// The old version stays running and macOS sends it every link, so the update would wait for a logout.
	if quitOtherBridges(10) > 0 {
		fmt.Println("An older Thingport Bridge is still running. It's replaced when you log out and back in.")
	}

	return targetExe, nil
}

func quitOtherBridges(graceSeconds float64) int {
	id := C.CString(bundleID)
	defer C.free(unsafe.Pointer(id))
	return int(C.TPQuitOtherBridges(id, C.double(graceSeconds)))
}

var releaseVersion = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

// Finder's Get Info shows it, the one place to read the version without a terminal.
func bundleVersion() string {
	if releaseVersion.MatchString(version) {
		return version
	}
	return "0.0.0"
}

func infoPlist() string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>Thingport Bridge</string>
	<key>CFBundleDisplayName</key>
	<string>Thingport Bridge</string>
	<key>CFBundleIdentifier</key>
	<string>` + bundleID + `</string>
	<key>CFBundleVersion</key>
	<string>` + bundleVersion() + `</string>
	<key>CFBundleShortVersionString</key>
	<string>` + bundleVersion() + `</string>
	<key>CFBundleExecutable</key>
	<string>` + bundleExeName + `</string>
	<key>CFBundleIconFile</key>
	<string>` + bundleIconName + `</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>LSMinimumSystemVersion</key>
	<string>10.13</string>
	<key>LSUIElement</key>
	<true/>
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLName</key>
			<string>Thingport Bridge Protocol</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>thingport</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
`
}

// On macOS a bare launch is always LaunchServices opening the bundle; URLs arrive as Apple Events.
// Blocks forever servicing them. Installing requires --install.
func runDefaultLaunch() {
	cfg, cfgDir := loadConfig()
	setupLogging(cfg, cfgDir)
	listenForAppleEventURLs(func(raw string) {
		if err := handleProtocol(raw, cfg); err != nil {
			log.Printf("error: %v", err)
		}
	})
}
