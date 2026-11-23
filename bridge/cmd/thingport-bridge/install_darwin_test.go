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
