//go:build windows

package main

import (
	"fmt"
	"syscall"
	"unsafe"
)

var shellExecuteW = syscall.NewLazyDLL("shell32.dll").NewProc("ShellExecuteW")

// openWithDefaultWindows opens a file with the app Windows associates with its type. Not through
// `cmd /c start`: cmd.exe would read a & in the filename as the start of another command.
// handleProtocol has already refused anything but a model file.
func openWithDefaultWindows(filePath string) error {
	verb, err := syscall.UTF16PtrFromString("open")
	if err != nil {
		return fmt.Errorf("invalid open verb")
	}
	target, err := syscall.UTF16PtrFromString(filePath)
	if err != nil {
		return fmt.Errorf("invalid file path")
	}
	// ShellExecuteW returns an HINSTANCE greater than 32 on success.
	result, _, _ := shellExecuteW.Call(
		0,
		uintptr(unsafe.Pointer(verb)),
		uintptr(unsafe.Pointer(target)),
		0,
		0,
		1, // SW_SHOWNORMAL
	)
	if result <= 32 {
		return fmt.Errorf("Windows file association launch failed (code %d)", result)
	}
	return nil
}
