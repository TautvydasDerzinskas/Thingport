//go:build !windows

package main

import "errors"

// openWithDefaultWindows is unavailable on non-Windows systems; their native
// open commands are used instead.
func openWithDefaultWindows(string) error {
	return errors.New("Windows file association API is unavailable on this platform")
}
