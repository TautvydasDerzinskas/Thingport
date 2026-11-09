package main

import (
	"bytes"
	"crypto/tls"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
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

func TestWindowsDefaultOpenFileExtensionAllowlist(t *testing.T) {
	for _, name := range []string{"model.stl", "MODEL.3MF", "model.step", "model.stp", "model.obj", "model.glb", "model.gltf", "model.f3d", "model.lbrn", "model.lbrn2", "print.gcode", "print.bgcode"} {
		if !isSafeDefaultFileExtension(name) {
			t.Errorf("valid model file rejected: %q", name)
		}
	}
	for _, name := range []string{"evil.exe", "evil.bat", "evil.cmd", "evil.ps1", "evil.lnk", "evil.url", "evil.stl.exe", "model", "script.sh", "archive.zip"} {
		if isSafeDefaultFileExtension(name) {
			t.Errorf("unsupported file accepted: %q", name)
		}
	}
}

func TestDownloadFileDoesNotExposeTokenInError(t *testing.T) {
	err := downloadFile("https://%zz/api/t/secret-jwt/model.stl", filepath.Join(t.TempDir(), "model.stl"))
	if err == nil || strings.Contains(err.Error(), "secret-jwt") {
		t.Fatalf("downloadFile error included session token: %v", err)
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
	if !strings.Contains(err.Error(), "TLS") {
		t.Fatalf("expected a safe TLS failure category, got %v", err)
	}
	if strings.Contains(err.Error(), token) || strings.Contains(logs.String(), token) {
		t.Fatalf("signed URL credential leaked in error or log: error=%v logs=%q", err, logs.String())
	}
}

func TestSafeDownloadErrorClassifiesRemoteTLSAlert(t *testing.T) {
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	server.TLS = &tls.Config{ClientAuth: tls.RequireAnyClientCert}
	server.StartTLS()
	defer server.Close()

	// Trust the test server certificate, but don't supply a client certificate.
	_, err := server.Client().Get(server.URL)
	if err == nil {
		t.Fatal("expected a TLS client-certificate alert")
	}
	if got := safeDownloadError(err).Error(); !strings.Contains(got, "TLS") {
		t.Fatalf("TLS alert was not classified as TLS: %q", got)
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
