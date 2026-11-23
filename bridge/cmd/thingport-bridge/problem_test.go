package main

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

func stubAsk(t *testing.T, fake func(problem) choice) {
	t.Helper()
	old := ask
	ask = fake
	t.Cleanup(func() { ask = old })
}

func openLinkTo(rawURL, filename string) string {
	return "thingport://open?url=" + url.QueryEscape(rawURL) + "&filename=" + url.QueryEscape(filename) + "&slicer=bambustudio"
}

// A slicer that starts and does nothing, so no test opens a real one.
func quietSlicer(t *testing.T) Config {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("needs a no-op command")
	}
	return Config{DownloadDir: t.TempDir(), Slicers: map[string]SlicerConfig{"bambustudio": {Command: "true"}}}
}

// What a connection macOS blocks from the local network fails with, as net/http hands it back.
func dialError(errno syscall.Errno) error {
	return &url.Error{Op: "Get", URL: "http://192.168.1.20/api/t/REDACTED/file/model.stl", Err: &net.OpError{
		Op: "dial", Net: "tcp", Err: os.NewSyscallError("connect", errno),
	}}
}

func TestServeLinkOnlyLogsLinksItRefuses(t *testing.T) {
	stubAsk(t, func(p problem) choice {
		t.Fatalf("asked about a refused link: %+v", p)
		return choiceClose
	})
	for _, raw := range []string{
		"thingport://open?url=" + url.QueryEscape("https://example.com/evil.exe"),
		"thingport://open?url=file:///etc/passwd",
		"thingport://delete?url=https://example.com/model.stl",
		// Pass the scheme check, but no request can be made from them.
		openLinkTo("http://%zz/model.stl", "model.stl"),
		openLinkTo("http:///model.stl", "model.stl"),
		openLinkTo("https://example.com:port/model.stl", "model.stl"),
	} {
		serveLink(raw, Config{DownloadDir: t.TempDir()})
	}
}

func TestServeLinkTriesAgainWhenAsked(t *testing.T) {
	hits := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if hits == 1 {
			http.Error(w, "busy", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte("solid t\nendsolid t\n"))
	}))
	defer server.Close()

	cfg := quietSlicer(t)
	var asked []problem
	stubAsk(t, func(p problem) choice { asked = append(asked, p); return choiceRetry })
	serveLink(openLinkTo(server.URL+"/model.stl", "model.stl"), cfg)

	if hits != 2 || len(asked) != 1 {
		t.Fatalf("expected one failure, one dialog and a second try: hits=%d dialogs=%d", hits, len(asked))
	}
	if !strings.Contains(asked[0].reason, "503") {
		t.Fatalf("dialog doesn't name the answer: %q", asked[0].reason)
	}
	// Retrying doesn't leave the first try's file behind as model.stl beside a model-1.stl.
	files, _ := filepath.Glob(filepath.Join(cfg.DownloadDir, "*"))
	if len(files) != 1 || filepath.Base(files[0]) != "model.stl" {
		t.Fatalf("expected just model.stl, got %v", files)
	}
}

func TestServeLinkStopsWhenClosed(t *testing.T) {
	hits := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		http.NotFound(w, r)
	}))
	defer server.Close()

	asked := 0
	stubAsk(t, func(problem) choice { asked++; return choiceClose })
	serveLink(openLinkTo(server.URL+"/model.3mf", "model.3mf"), Config{DownloadDir: t.TempDir()})
	if hits != 1 || asked != 1 {
		t.Fatalf("expected one try and one dialog, got %d tries and %d dialogs", hits, asked)
	}
}

func TestExplainSaysWhatWentWrong(t *testing.T) {
	l := link{downloadURL: "http://192.168.1.20:3000/api/t/secret/file/model.stl", filename: "model.stl"}
	host := "192.168.1.20:3000"
	tests := []struct {
		name string
		err  error
		want string
	}{
		{"expired", &statusError{code: 401, status: "401 Unauthorized"}, "expired"},
		{"forbidden", &statusError{code: 403, status: "403 Forbidden"}, "expired"},
		{"gone", &statusError{code: 404, status: "404 Not Found"}, "no longer has"},
		{"other answer", &statusError{code: 502, status: "502 Bad Gateway"}, host + ` answered "502 Bad Gateway"`},
		{"disk", &saveError{dir: "/tmp/x", err: errors.New("create file: read-only")}, "save the file in /tmp/x"},
		{"slicer", launchFailed("/Applications/BambuStudio.app", errors.New("boom")), "start BambuStudio"},
		{"default app", launchFailed("", errors.New("boom")), "default app"},
		{"refused", dialError(syscall.ECONNREFUSED), "Nothing answered at " + host},
		{"no name", &url.Error{Op: "Get", Err: &net.DNSError{Err: "no such host", Name: "x"}}, "can't find " + host},
		{"timeout", &url.Error{Op: "Get", Err: &net.OpError{Op: "dial", Err: timeoutError{}}}, "took too long"},
		{"unknown", errors.New("weird"), "Something went wrong"},
		// Only on macOS 15 and later is the Local Network permission a likely cause.
		{"unreachable", dialError(syscall.EHOSTUNREACH), "This computer can't reach " + host},
		{"blocked", dialError(syscall.EHOSTUNREACH), "may be blocking it from your local network"},
	}
	for _, privacy := range []bool{false, true} {
		withLocalNetworkPrivacy(t, privacy)
		for _, tc := range tests {
			if tc.name == "unreachable" && privacy || tc.name == "blocked" && !privacy {
				continue
			}
			p := explain(l, tc.err)
			if !strings.Contains(p.reason, tc.want) {
				t.Errorf("%s: reason %q doesn't say %q", tc.name, p.reason, tc.want)
			}
			if p.title != "Couldn't open model.stl" {
				t.Errorf("%s: title %q", tc.name, p.title)
			}
			if wantSettings := tc.name == "blocked"; p.localNetwork != wantSettings {
				t.Errorf("%s: localNetwork = %v", tc.name, p.localNetwork)
			}
		}
	}
}

func withLocalNetworkPrivacy(t *testing.T, on bool) {
	t.Helper()
	old := localNetworkPrivacy
	localNetworkPrivacy = on
	t.Cleanup(func() { localNetworkPrivacy = old })
}

func TestHasLocalNetworkPrivacyFromMacOS15(t *testing.T) {
	for release, want := range map[string]bool{
		"21.6.0": false, // macOS 12
		"23.6.0": false, // macOS 14
		"24.0.0": true,  // macOS 15
		"25.1.0": true,  // macOS 26
		"":       true,
	} {
		if got := hasLocalNetworkPrivacy(release); got != want {
			t.Errorf("hasLocalNetworkPrivacy(%q) = %v", release, got)
		}
	}
}

type timeoutError struct{}

func (timeoutError) Error() string   { return "i/o timeout" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return true }

func TestExplainLeavesTheRequestOutOfTheDetail(t *testing.T) {
	p := explain(link{downloadURL: "http://192.168.1.20/x.stl", filename: "x.stl"}, fmt.Errorf("download: %w", dialError(syscall.ECONNREFUSED)))
	if strings.Contains(p.detail, "/api/t/") || !strings.Contains(p.detail, "connection refused") {
		t.Fatalf("detail should be the cause alone: %q", p.detail)
	}
}

func TestExplainNamesAConnectionNothingAnswers(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()
	listener.Close()

	l := link{downloadURL: "http://" + addr + "/model.stl", filename: "model.stl"}
	err = downloadFile(l.downloadURL, filepath.Join(t.TempDir(), "model.stl"))
	if p := explain(l, err); !strings.Contains(p.reason, "Nothing answered at "+addr) {
		t.Fatalf("reason %q for %v", p.reason, err)
	}
}

func TestRetryWhileBlockedGivesUpOnOtherErrors(t *testing.T) {
	withLocalNetworkPrivacy(t, true)
	tries := 0
	err := retryWhileBlocked(time.Minute, func() error { tries++; return dialError(syscall.ECONNREFUSED) })
	if err == nil || tries != 1 {
		t.Fatalf("expected one try, got %d (%v)", tries, err)
	}

	// Before macOS 15, or off macOS, "no route to host" is only that.
	withLocalNetworkPrivacy(t, false)
	tries = 0
	err = retryWhileBlocked(time.Minute, func() error { tries++; return dialError(syscall.EHOSTUNREACH) })
	if err == nil || tries != 1 {
		t.Fatalf("expected one try, got %d (%v)", tries, err)
	}
}

func TestRetryWhileBlockedWaitsForLocalNetworkAccess(t *testing.T) {
	withLocalNetworkPrivacy(t, true)
	old := blockedPoll
	blockedPoll = time.Millisecond
	defer func() { blockedPoll = old }()

	tries := 0
	err := retryWhileBlocked(time.Minute, func() error {
		tries++
		if tries < 3 {
			return dialError(syscall.EHOSTUNREACH)
		}
		return nil
	})
	if err != nil || tries != 3 {
		t.Fatalf("expected success on the third try, got %d tries (%v)", tries, err)
	}

	tries = 0
	err = retryWhileBlocked(0, func() error { tries++; return dialError(syscall.EHOSTUNREACH) })
	if !localNetworkBlocked(err) || tries != 1 {
		t.Fatalf("expected one try without a wait, got %d (%v)", tries, err)
	}
}

func TestDownloadFileRemovesHalfAFile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "1000")
		_, _ = w.Write([]byte("solid t\n"))
	}))
	defer server.Close()

	target := filepath.Join(t.TempDir(), "model.stl")
	if err := downloadFile(server.URL+"/model.stl", target); err == nil {
		t.Fatal("expected the short body to fail")
	}
	if fileExists(target) {
		t.Fatal("left half a file behind")
	}
}
