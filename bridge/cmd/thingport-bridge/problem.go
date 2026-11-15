package main

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
)

// problem is what the error dialog says about a link that failed to open.
type problem struct {
	title  string
	reason string
	detail string
	// macOS blocks the Bridge from the local network, so the dialog offers that setting.
	localNetwork bool
}

type choice int

const (
	choiceClose choice = iota
	choiceRetry
	choiceSettings
)

// statusError is a download that the instance answered with something other than the file.
type statusError struct {
	code   int
	status string
}

func (e *statusError) Error() string { return "download failed: " + e.status }

// saveError is a download that couldn't be written to disk.
type saveError struct {
	dir string
	err error
}

func (e *saveError) Error() string { return e.err.Error() }
func (e *saveError) Unwrap() error { return e.err }

// launchError is a slicer, or the default app, that wouldn't start.
type launchError struct {
	command string
	err     error
}

func (e *launchError) Error() string { return "launch: " + e.err.Error() }
func (e *launchError) Unwrap() error { return e.err }

func launchFailed(command string, err error) error {
	if err == nil {
		return nil
	}
	return &launchError{command: command, err: err}
}

// Winsock's codes for the same errors, which Go's syscall constants don't match on Windows.
const (
	wsaConnRefused = syscall.Errno(10061)
	wsaNetUnreach  = syscall.Errno(10051)
	wsaHostUnreach = syscall.Errno(10065)
)

// localNetworkBlocked is macOS refusing the Bridge a connection to an address on the local network: macOS 15
// and later ask before an app may, and fail the connection with "no route to host" until it's allowed.
func localNetworkBlocked(err error) bool {
	return runtime.GOOS == "darwin" && errors.Is(err, syscall.EHOSTUNREACH)
}

// explain turns a failed open into words for the error dialog. The error itself, which the log has in full, goes in
// detail.
func explain(l link, err error) problem {
	// Never the URL itself: it carries the sign-in.
	host := "your Thingport instance"
	if u, perr := url.Parse(l.downloadURL); perr == nil && u.Host != "" {
		host = u.Host
	}
	// The cause, without the request it failed on: the dialog has the host already.
	cause := err
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		cause = urlErr.Err
	}
	p := problem{
		title:  "Couldn't open " + shorten(l.filename, 60),
		reason: reasonFor(err, host),
		detail: "Details: " + cause.Error(),
	}
	if logPath != "" {
		p.detail += "\nLog: " + homeRelative(logPath)
	}
	p.localNetwork = localNetworkBlocked(err)
	return p
}

func reasonFor(err error, host string) string {
	var status *statusError
	var save *saveError
	var launch *launchError
	var dns *net.DNSError
	var cert *tls.CertificateVerificationError
	var netErr net.Error
	switch {
	case errors.As(err, &status):
		switch status.code {
		case http.StatusUnauthorized, http.StatusForbidden:
			return "The link has expired. Open the model again from Thingport."
		case http.StatusNotFound, http.StatusGone:
			return "Thingport no longer has this file."
		default:
			return fmt.Sprintf("%s answered %q instead of sending the file.", host, status.status)
		}
	case errors.As(err, &save):
		return "Couldn't save the file in " + save.dir + "."
	case errors.As(err, &launch):
		if launch.command == "" {
			return "Couldn't open the file with its default app."
		}
		return "Couldn't start " + appName(launch.command) + "."
	case localNetworkBlocked(err):
		return "macOS is blocking Thingport Bridge from your local network, so it can't reach " + host +
			". Allow it in System Settings → Privacy & Security → Local Network."
	case errors.As(err, &cert):
		return "This computer doesn't trust the certificate of " + host + ". Trust it on this computer and try again."
	case errors.As(err, &dns):
		return "This computer can't find " + host + "."
	case isErrno(err, syscall.ECONNREFUSED, wsaConnRefused):
		return "Nothing answered at " + host + ". Check that Thingport is running there."
	case isErrno(err, syscall.EHOSTUNREACH, wsaHostUnreach), isErrno(err, syscall.ENETUNREACH, wsaNetUnreach):
		return "This computer can't reach " + host + "."
	case errors.As(err, &netErr) && netErr.Timeout():
		return host + " took too long to answer."
	default:
		return "Something went wrong while opening it."
	}
}

func isErrno(err error, codes ...syscall.Errno) bool {
	for _, code := range codes {
		if errors.Is(err, code) {
			return true
		}
	}
	return false
}

// appName is a slicer's name as people know it: "BambuStudio" for /Applications/BambuStudio.app.
func appName(command string) string {
	base := filepath.Base(command)
	if i := strings.LastIndex(base, "."); i > 0 {
		base = base[:i]
	}
	return base
}

// homeRelative writes a path in the home folder as ~/..., which fits the dialog's narrow text. Not on Windows,
// where ~ means nothing.
func homeRelative(p string) string {
	home, err := os.UserHomeDir()
	if runtime.GOOS == "windows" || err != nil || home == "" {
		return p
	}
	if rel, err := filepath.Rel(home, p); err == nil && !strings.HasPrefix(rel, "..") {
		return filepath.Join("~", rel)
	}
	return p
}

func shorten(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max-1]) + "…"
}
