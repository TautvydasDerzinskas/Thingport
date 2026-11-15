//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

var messageBoxW = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")

const (
	mbRetryCancel   = 0x00000005
	mbIconWarning   = 0x00000030
	mbSetForeground = 0x00010000
	mbTopmost       = 0x00040000
	idRetry         = 4
)

func askAboutFailure(p problem) choice {
	text, err := syscall.UTF16PtrFromString(p.title + "\n\n" + p.reason + "\n\n" + p.detail)
	if err != nil {
		return choiceClose
	}
	caption, err := syscall.UTF16PtrFromString("Thingport Bridge")
	if err != nil {
		return choiceClose
	}
	// The browser started the Bridge, so without these the box could open behind it.
	flags := uintptr(mbRetryCancel | mbIconWarning | mbSetForeground | mbTopmost)
	result, _, _ := messageBoxW.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(caption)), flags)
	if result == idRetry {
		return choiceRetry
	}
	return choiceClose
}

// Only macOS blocks the local network.
func openLocalNetworkSettings() {}
