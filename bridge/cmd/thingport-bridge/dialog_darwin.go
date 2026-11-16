//go:build darwin

package main

/*
#include <stdlib.h>

int TPAskAboutFailure(const char *title, const char *text, int offerSettings);
*/
import "C"

import (
	"log"
	"os/exec"
	"runtime"
	"syscall"
	"unsafe"
)

// Cocoa's run loop and its dialogs only work on the main thread, which the main goroutine starts on.
func init() {
	runtime.LockOSThread()
}

// macOS 14 and older have no Local Network permission, so "no route to host" there is only that.
var localNetworkPrivacy = func() bool {
	release, _ := syscall.Sysctl("kern.osrelease")
	return hasLocalNetworkPrivacy(release)
}()

// The Local Network list in Privacy & Security.
const localNetworkSettingsURL = "x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork"

func askAboutFailure(p problem) choice {
	title := C.CString(p.title)
	defer C.free(unsafe.Pointer(title))
	text := C.CString(p.reason + "\n\n" + p.detail)
	defer C.free(unsafe.Pointer(text))
	offer := C.int(0)
	if p.localNetwork {
		offer = 1
	}
	return choice(C.TPAskAboutFailure(title, text, offer))
}

func openLocalNetworkSettings() {
	if err := exec.Command("open", localNetworkSettingsURL).Run(); err != nil {
		log.Printf("open Local Network settings: %v", err)
	}
}
