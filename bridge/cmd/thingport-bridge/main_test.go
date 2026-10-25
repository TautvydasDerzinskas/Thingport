package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSanitizeFilename(t *testing.T) {
	tests := map[string]string{
		" model.3mf ":               "model.3mf",
		"../unsafe:model?.stl":      "unsafemodel.stl",
		"\x00\x01":                  "model",
		"folder\\another/file.step": "file.step",
	}

	for input, expected := range tests {
		if actual := sanitizeFilename(input); actual != expected {
			t.Fatalf("sanitizeFilename(%q) = %q, expected %q", input, actual, expected)
		}
	}
}

func TestRedactURLHidesTokenQueryValue(t *testing.T) {
	redacted := redactURL("https://thingport.example/file?id=asset-1&token=secret-value")
	if strings.Contains(redacted, "secret-value") {
		t.Fatalf("redacted URL still contains the token: %s", redacted)
	}
	if !strings.Contains(redacted, "token=REDACTED") {
		t.Fatalf("redacted URL does not contain the marker: %s", redacted)
	}
}

func TestFindWindowsCommandResolvesVersionedCuraInstall(t *testing.T) {
	base := t.TempDir()
	t.Setenv("LOCALAPPDATA", base)
	t.Setenv("ProgramFiles", "")
	t.Setenv("ProgramFiles(x86)", "")

	// Cura needs the glob. The older dir has no exe, so an empty match must be skipped.
	older := filepath.Join(base, "UltiMaker Cura 5.7")
	newer := filepath.Join(base, "UltiMaker Cura 5.8")
	if err := os.MkdirAll(older, 0755); err != nil {
		t.Fatalf("mkdir older: %v", err)
	}
	if err := os.MkdirAll(newer, 0755); err != nil {
		t.Fatalf("mkdir newer: %v", err)
	}
	exePath := filepath.Join(newer, "UltiMaker-Cura.exe")
	if err := os.WriteFile(exePath, nil, 0644); err != nil {
		t.Fatalf("write exe: %v", err)
	}

	if got := findWindowsCommand("cura", windowsCandidates()); got != exePath {
		t.Fatalf("findWindowsCommand(\"cura\", ...) = %q, expected %q", got, exePath)
	}
}

func TestFindWindowsCommandResolvesAnycubicSlicerNext(t *testing.T) {
	base := t.TempDir()
	t.Setenv("ProgramFiles", base)
	t.Setenv("ProgramFiles(x86)", "")
	t.Setenv("LOCALAPPDATA", "")

	// The folder name isn't documented, so the glob must find an unexpected one.
	dir := filepath.Join(base, "Anycubic Slicer Next 1.3")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	exePath := filepath.Join(dir, "AnycubicSlicerNext.exe")
	if err := os.WriteFile(exePath, nil, 0644); err != nil {
		t.Fatalf("write exe: %v", err)
	}

	if got := findWindowsCommand("anycubicslicernext", windowsCandidates()); got != exePath {
		t.Fatalf("findWindowsCommand(\"anycubicslicernext\", ...) = %q, expected %q", got, exePath)
	}
}

func TestFindMacCommandChecksUserApplications(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	appPath := filepath.Join(home, "Applications", "AnycubicSlicerNext.app")
	if err := os.MkdirAll(appPath, 0755); err != nil {
		t.Fatalf("mkdir app: %v", err)
	}
	candidates := map[string][]string{"anycubicslicernext": {"/Applications/AnycubicSlicerNext.app"}}
	if got := findMacCommand("anycubicslicernext", candidates); got != appPath {
		t.Fatalf("findMacCommand(...) = %q, expected %q", got, appPath)
	}
}

func TestHandleProtocolRejectsUntrustedShapesBeforeDownload(t *testing.T) {
	tests := []string{
		"https://thingport.example/file",
		"thingport://delete?url=https://thingport.example/file",
		"thingport://open",
		"thingport://open?url=file:///tmp/model.stl",
	}

	for _, raw := range tests {
		if err := handleProtocol(raw, Config{}); err == nil {
			t.Fatalf("handleProtocol(%q) unexpectedly succeeded", raw)
		}
	}
}

func TestFindWindowsCommandResolvesBambuStudioInstallerExe(t *testing.T) {
	base := t.TempDir()
	t.Setenv("ProgramFiles", base)
	t.Setenv("ProgramFiles(x86)", "")
	t.Setenv("LOCALAPPDATA", "")

	// The official installer's layout: bambu-studio.exe beside BambuStudio.dll, no BambuStudio.exe.
	dir := filepath.Join(base, "Bambu Studio")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	exePath := filepath.Join(dir, "bambu-studio.exe")
	for _, name := range []string{"bambu-studio.exe", "BambuStudio.dll"} {
		if err := os.WriteFile(filepath.Join(dir, name), nil, 0644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}

	if got := findWindowsCommand("bambustudio", windowsCandidates()); got != exePath {
		t.Fatalf("findWindowsCommand(\"bambustudio\", ...) = %q, expected %q", got, exePath)
	}
}
