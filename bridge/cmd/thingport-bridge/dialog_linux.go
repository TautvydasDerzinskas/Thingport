//go:build linux

package main

import (
	"os"
	"os/exec"
)

// Through zenity (GNOME and most others) or kdialog (KDE). With neither, the log is all there is.
func askAboutFailure(p problem) choice {
	if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
		return choiceClose
	}
	text := p.title + "\n\n" + p.reason + "\n\n" + p.detail
	dialogs := [][]string{
		// --no-markup, or zenity reads the & or < of a filename as markup.
		{"zenity", "--question", "--no-markup", "--title", "Thingport Bridge", "--text", text,
			"--ok-label", "Try Again", "--cancel-label", "Close"},
		{"kdialog", "--title", "Thingport Bridge", "--warningyesno", text,
			"--yes-label", "Try Again", "--no-label", "Close"},
	}
	for _, d := range dialogs {
		bin, err := exec.LookPath(d[0])
		if err != nil {
			continue
		}
		// Both exit 0 for the first button and non-zero for the other, or when the dialog is closed.
		if exec.Command(bin, d[1:]...).Run() == nil {
			return choiceRetry
		}
		return choiceClose
	}
	return choiceClose
}

// Only macOS blocks the local network.
func openLocalNetworkSettings() {}
