package main

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
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

func TestRedactURLHidesTokenPathValue(t *testing.T) {
	redacted := redactURL("https://thingport.example/api/t/secret-jwt/print/1/plate/2/file/model.stl")
	if strings.Contains(redacted, "secret-jwt") || !strings.Contains(redacted, "/api/t/REDACTED/") {
		t.Fatalf("redacted URL contains a session token: %s", redacted)
	}
}

func TestRedactURLHidesAllSignedPathTokens(t *testing.T) {
	redacted := redactURL("https://thingport.example/api/t/first-jwt/api/t/second-jwt/file/model.stl?token=query-jwt")
	for _, secret := range []string{"first-jwt", "second-jwt", "query-jwt"} {
		if strings.Contains(redacted, secret) {
			t.Fatalf("redacted URL still includes a credential %q: %s", secret, redacted)
		}
	}
	if strings.Count(redacted, "/api/t/REDACTED") != 2 {
		t.Fatalf("expected both signed path segments to be redacted: %s", redacted)
	}
}

func TestRedactURLHidesURLUserInfo(t *testing.T) {
	redacted := redactURL("ftp://alice:secret-password@thingport.example/model.stl")
	if strings.Contains(redacted, "alice") || strings.Contains(redacted, "secret-password") {
		t.Fatalf("redacted URL contains credentials: %s", redacted)
	}
	if !strings.Contains(redacted, "REDACTED@") {
		t.Fatalf("expected redacted user info, got %s", redacted)
	}
}

func TestIsModelFile(t *testing.T) {
	for _, name := range []string{"model.stl", "MODEL.3MF", "plate.gcode.3mf", "model.step", "model.stp", "model.obj", "model.glb", "model.gltf", "model.f3d", "model.lbrn", "model.lbrn2", "print.gcode", "print.bgcode"} {
		if !isModelFile(name) {
			t.Errorf("valid model file rejected: %q", name)
		}
	}
	for _, name := range []string{"evil.exe", "evil.bat", "evil.cmd", "evil.ps1", "evil.lnk", "evil.url", "evil.stl.exe", "evil.command", "evil.terminal", "evil.desktop", "model", "script.sh", "archive.zip"} {
		if isModelFile(name) {
			t.Errorf("unsupported file accepted: %q", name)
		}
	}
}

func TestHandleProtocolRefusesWhatIsntAModelBeforeDownload(t *testing.T) {
	hits := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		_, _ = w.Write([]byte("MZ"))
	}))
	defer server.Close()

	links := []string{
		// Named by the filename parameter, or else by the URL.
		"thingport://open?url=" + url.QueryEscape(server.URL+"/model.stl") + "&filename=evil.exe&slicer=other",
		"thingport://open?url=" + url.QueryEscape(server.URL+"/evil.exe") + "&slicer=other",
		"thingport://open?url=" + url.QueryEscape(server.URL+"/x") + "&filename=evil.terminal&slicer=orcaslicer",
	}
	for _, link := range links {
		err := handleProtocol(link, Config{DownloadDir: t.TempDir()})
		if err == nil || !strings.Contains(err.Error(), "not a model file") {
			t.Errorf("handleProtocol(%q) = %v, expected a refusal", link, err)
		}
	}
	if hits != 0 {
		t.Fatalf("downloaded %d refused files", hits)
	}
}

func TestDownloadFileDoesNotExposeTokenInError(t *testing.T) {
	err := downloadFile("https://%zz/api/t/secret-jwt/model.stl", filepath.Join(t.TempDir(), "model.stl"))
	if err == nil || strings.Contains(err.Error(), "secret-jwt") {
		t.Fatalf("downloadFile error included session token: %v", err)
	}
}

// Thingport reads the version from it to say when a newer Bridge is out; 1.0.1 and older sent Go's default.
func TestDownloadFileNamesTheBridgeAndItsVersion(t *testing.T) {
	var got string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("User-Agent")
		_, _ = w.Write([]byte("solid t\nendsolid t\n"))
	}))
	defer server.Close()

	old := version
	version = "1.2.3"
	defer func() { version = old }()
	if err := downloadFile(server.URL+"/model.stl", filepath.Join(t.TempDir(), "model.stl")); err != nil {
		t.Fatal(err)
	}
	if want := "Thingport-Bridge/1.2.3 (" + runtime.GOOS + ")"; got != want {
		t.Fatalf("User-Agent = %q, want %q", got, want)
	}
}

func TestDownloadTLSErrorDoesNotLeakSignedURL(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	const token = "secret-jwt-for-a-valid-url"
	downloadURL := server.URL + "/api/t/" + token + "/file/model.stl"
	var logs bytes.Buffer
	oldLog := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(oldLog)

	protocolURL := "thingport://open?url=" + url.QueryEscape(downloadURL) + "&slicer=crealityprintlink&filename=model.stl"
	err := handleProtocol(protocolURL, Config{DownloadDir: t.TempDir()})
	if err == nil {
		t.Fatal("expected TLS verification failure")
	}
	// The cause stays, for whoever reads the log; only the URL's sign-in goes.
	if !strings.Contains(err.Error(), "certificate") || !strings.Contains(err.Error(), "/api/t/REDACTED/") {
		t.Fatalf("expected the certificate error with the URL redacted, got %v", err)
	}
	if strings.Contains(err.Error(), token) || strings.Contains(logs.String(), token) {
		t.Fatalf("signed URL credential leaked in error or log: error=%v logs=%q", err, logs.String())
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

func TestFindMacCommandResolvesQIDIStudio(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	appPath := filepath.Join(home, "Applications", "QIDIStudio.app")
	if err := os.MkdirAll(appPath, 0755); err != nil {
		t.Fatalf("mkdir app: %v", err)
	}
	candidates := map[string][]string{"qidistudio": {"/Applications/QIDIStudio.app"}}
	if got := findMacCommand("qidistudio", candidates); got != appPath {
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

func TestNewestVersionCountsVersionsAsNumbers(t *testing.T) {
	got := newestVersion([]string{"Creality Print 7.10", "Creality Print 7.9", "Creality Print 6.2"})
	if got != "Creality Print 7.10" {
		t.Fatalf("newestVersion = %q, expected Creality Print 7.10", got)
	}
	if got := newestVersion([]string{"UltiMaker Cura 5.10.0", "UltiMaker Cura 5.9.1"}); got != "UltiMaker Cura 5.10.0" {
		t.Fatalf("newestVersion = %q, expected UltiMaker Cura 5.10.0", got)
	}
}

func TestFindWindowsCommandResolvesCrealityPrint(t *testing.T) {
	base := t.TempDir()
	t.Setenv("ProgramFiles", base)
	t.Setenv("ProgramFiles(x86)", "")
	t.Setenv("LOCALAPPDATA", "")

	dir := filepath.Join(base, "Creality", "Creality Print 7.3")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	exePath := filepath.Join(dir, "CrealityPrint.exe")
	if err := os.WriteFile(exePath, nil, 0644); err != nil {
		t.Fatalf("write exe: %v", err)
	}
	if got := findWindowsCommand("crealityprintlink", windowsCandidates()); got != exePath {
		t.Fatalf("findWindowsCommand(crealityprintlink) = %q, expected %q", got, exePath)
	}
}

// The layouts the official installers write, read from their NSIS headers.
func TestFindWindowsCommandResolvesBridgeableSlicers(t *testing.T) {
	tests := []struct {
		id, base, rel string
	}{
		{"orcaslicer", "ProgramFiles", "OrcaSlicer/orca-slicer.exe"},
		{"qidistudio", "ProgramFiles", "QIDIStudio/qidi-studio.exe"},
		{"crealityprintlink", "ProgramFiles", "Creality Print 5.1/CrealityPrint.exe"},
		{"elegooslicer", "ProgramFiles", "ElegooSlicer/elegoo-slicer.exe"},
		{"snapmaker-orca", "ProgramFiles", "Snapmaker_Orca/snapmaker-orca.exe"},
		{"eufystudio3d", "LOCALAPPDATA", "eufyMake Studio 3D/eufymake studio.exe"},
		{"eufystudio3d", "LOCALAPPDATA", "AnkerMake Studio/AnkerMake Studio.exe"},
	}
	for _, tt := range tests {
		base := t.TempDir()
		for _, key := range []string{"ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"} {
			t.Setenv(key, "")
		}
		t.Setenv(tt.base, base)
		exePath := filepath.Join(base, filepath.FromSlash(tt.rel))
		if err := os.MkdirAll(filepath.Dir(exePath), 0755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(exePath, nil, 0644); err != nil {
			t.Fatalf("write exe: %v", err)
		}
		if got := findWindowsCommand(tt.id, windowsCandidates()); filepath.Clean(got) != exePath {
			t.Errorf("findWindowsCommand(%s) = %q, expected %q", tt.id, got, exePath)
		}
	}
}

func TestFindWindowsCommandLeavesEufyMakesUVAppAlone(t *testing.T) {
	base := t.TempDir()
	t.Setenv("ProgramFiles", "")
	t.Setenv("ProgramFiles(x86)", "")
	t.Setenv("LOCALAPPDATA", base)
	// eufyMake's app for its UV printer installs here too.
	dir := filepath.Join(base, "eufyMake Studio")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "eufyMake Studio.exe"), nil, 0644); err != nil {
		t.Fatalf("write exe: %v", err)
	}
	if got := findWindowsCommand("eufystudio3d", windowsCandidates()); got != "" {
		t.Fatalf("findWindowsCommand(eufystudio3d) = %q, expected none", got)
	}
}

func TestFindLinuxCommandLooksInFlatpakExports(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Linux lookup")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("PATH", "")
	dir := filepath.Join(home, ".local/share/flatpak/exports/bin")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	launcher := filepath.Join(dir, "io.github.Snapmaker.Snapmaker_Orca")
	if err := os.WriteFile(launcher, []byte("#!/bin/sh\n"), 0755); err != nil {
		t.Fatalf("write launcher: %v", err)
	}
	if got := findLinuxCommand("snapmaker-orca", linuxCandidates()); got != launcher {
		t.Fatalf("findLinuxCommand(snapmaker-orca) = %q, expected %q", got, launcher)
	}
}

func TestFindLinuxCommandResolvesQIDIStudio(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Linux lookup")
	}
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	launcher := filepath.Join(dir, "qidi-studio")
	if err := os.WriteFile(launcher, []byte("#!/bin/sh\n"), 0755); err != nil {
		t.Fatalf("write launcher: %v", err)
	}
	if got := findLinuxCommand("qidistudio", linuxCandidates()); got != launcher {
		t.Fatalf("findLinuxCommand(qidistudio) = %q, expected %q", got, launcher)
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
