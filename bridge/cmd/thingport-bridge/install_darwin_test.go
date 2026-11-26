//go:build darwin

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Without it, macOS's Local Network prompt doesn't say why the Bridge asks.
func TestInfoPlistExplainsLocalNetworkAccess(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Info.plist")
	if err := os.WriteFile(path, []byte(infoPlist()), 0644); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command("plutil", "-extract", "NSLocalNetworkUsageDescription", "raw", path).CombinedOutput()
	if err != nil || !strings.Contains(string(out), "Thingport instance") {
		t.Fatalf("plutil: %v %s", err, out)
	}
}

func TestSignAppBundleUsesBundleIdentifier(t *testing.T) {
	dir := t.TempDir()
	argsFile := filepath.Join(dir, "args")
	codesign := filepath.Join(dir, "codesign")
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > " + argsFile + "\n"
	if err := os.WriteFile(codesign, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)

	appDir := filepath.Join(dir, "Thingport Bridge.app")
	if err := signAppBundle(appDir); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Split(strings.TrimSpace(string(data)), "\n")
	want := []string{
		"--force",
		"--deep",
		"--sign",
		"-",
		"--identifier",
		bundleID,
		appDir,
	}
	if len(got) != len(want) {
		t.Fatalf("codesign args = %q, want %q", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("codesign args = %q, want %q", got, want)
		}
	}
}
