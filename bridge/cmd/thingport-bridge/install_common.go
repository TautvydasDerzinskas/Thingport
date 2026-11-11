package main

import (
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func samePath(a, b string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
	}
	return filepath.Clean(a) == filepath.Clean(b)
}

// replaceFile writes src to a new file beside dst and renames it over dst. Rewriting dst in place
// while an older Bridge runs from it breaks updates: Linux refuses (text file busy), and macOS kills
// the new binary at every launch.
func replaceFile(src, dst string, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.CreateTemp(filepath.Dir(dst), "."+filepath.Base(dst)+".*")
	if err != nil {
		return err
	}
	tmp := out.Name()
	err = writeAndClose(out, in, perm)
	if err == nil {
		err = os.Rename(tmp, dst)
	}
	if err != nil {
		_ = os.Remove(tmp)
	}
	return err
}

func writeAndClose(out *os.File, in io.Reader, perm os.FileMode) error {
	_, err := io.Copy(out, in)
	if err == nil {
		err = out.Sync()
	}
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	if err == nil && perm != 0 && runtime.GOOS != "windows" {
		err = os.Chmod(out.Name(), perm)
	}
	return err
}
