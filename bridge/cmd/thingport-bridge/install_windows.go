//go:build windows

package main

import "fmt"

func installSelf() (string, error) {
	return "", fmt.Errorf("install Thingport Bridge with the Windows Setup application")
}

func runDefaultLaunch() {
	fmt.Println("Thingport Bridge runs when a thingport:// link is opened.")
	fmt.Println("Install or update it with the Thingport Bridge Setup application.")
}
