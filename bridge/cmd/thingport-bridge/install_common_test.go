package main

import (
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// An older Bridge may be running from dst while it's updated (on macOS it always is), so the old file
// must stay as it was for it, and the new one must be a separate file.
func TestReplaceFileLeavesTheOpenOldFileAlone(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows can't rename over an open file; its Bridge exits once the slicer starts")
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "new")
	dst := filepath.Join(dir, "bin", "thingport-bridge")
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dst, []byte("old version"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(src, []byte("new version"), 0644); err != nil {
		t.Fatal(err)
	}
	running, err := os.Open(dst)
	if err != nil {
		t.Fatal(err)
	}
	defer running.Close()

	if err := replaceFile(src, dst, 0755); err != nil {
		t.Fatalf("replaceFile: %v", err)
	}

	if got, _ := io.ReadAll(running); string(got) != "old version" {
		t.Errorf("open old file reads %q, want it untouched", got)
	}
	if got, _ := os.ReadFile(dst); string(got) != "new version" {
		t.Errorf("dst = %q, want the new version", got)
	}
	if info, err := os.Stat(dst); err != nil || info.Mode().Perm() != 0755 {
		t.Errorf("dst mode = %v (%v), want 0755", info.Mode().Perm(), err)
	}
	if entries, _ := os.ReadDir(filepath.Dir(dst)); len(entries) != 1 {
		t.Errorf("left %d files beside dst, want only dst", len(entries))
	}
}

func TestReplaceFileCreatesMissingDirs(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "new")
	dst := filepath.Join(dir, "a", "b", "thingport-bridge")
	if err := os.WriteFile(src, []byte("bridge"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := replaceFile(src, dst, 0755); err != nil {
		t.Fatalf("replaceFile: %v", err)
	}
	if got, _ := os.ReadFile(dst); string(got) != "bridge" {
		t.Errorf("dst = %q", got)
	}
}
