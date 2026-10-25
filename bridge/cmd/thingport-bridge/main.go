package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

type SlicerConfig struct {
	Command string   `json:"command"`
	Args    []string `json:"args,omitempty"`
}

type Config struct {
	DownloadDir string                  `json:"download_dir,omitempty"`
	LogFile     string                  `json:"log_file,omitempty"`
	Slicers     map[string]SlicerConfig `json:"slicers,omitempty"`
}

// Only for slicers Thingport can't hand off to directly: bambustudio:// and prusaslicer:// only
// accept allowlisted domains, and Cura's cura:// registration is unreliable. OrcaSlicer accepts
// any URL, so it never reaches here.
const scheme = "thingport"

func main() {
	if len(os.Args) < 2 {
		// Windows/Linux pass the URL as argv[1], so no args means "install". macOS delivers it as an
		// Apple Event instead, so install there needs --install.
		runDefaultLaunch()
		return
	}

	arg := strings.TrimSpace(os.Args[1])
	switch arg {
	case "", "-h", "--help":
		printUsage()
		return
	case "install", "--install":
		runInstallAndReport()
		return
	}

	cfg, cfgDir := loadConfig()
	setupLogging(cfg, cfgDir)

	if err := handleProtocol(arg, cfg); err != nil {
		log.Printf("error: %v", err)
	}
}

func printUsage() {
	fmt.Println("Usage:")
	fmt.Println("  thingport-bridge --install")
	fmt.Println("  thingport-bridge <thingport://open?...>")
}

func runInstallAndReport() {
	target, err := installSelf()
	if err != nil {
		fmt.Printf("Install failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Installed Thingport Bridge at %s\n", target)
	fmt.Println("You can now use \"Open in Bambu Studio\" from Thingport.")
}

func handleProtocol(raw string, cfg Config) error {
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("parse url: %w", err)
	}
	if parsed.Scheme != scheme {
		return fmt.Errorf("unexpected scheme: %s", parsed.Scheme)
	}

	action := strings.Trim(parsed.Host, "/")
	if action == "" {
		action = strings.Trim(parsed.Path, "/")
	}
	if action == "" {
		action = "open"
	}
	if action != "open" {
		return fmt.Errorf("unsupported action: %s", action)
	}

	q := parsed.Query()
	downloadURL := strings.TrimSpace(q.Get("url"))
	if downloadURL == "" {
		return errors.New("missing url parameter")
	}
	if !strings.HasPrefix(downloadURL, "http://") && !strings.HasPrefix(downloadURL, "https://") {
		return fmt.Errorf("unsupported url: %s", redactURL(downloadURL))
	}

	filename := strings.TrimSpace(q.Get("filename"))
	if filename == "" {
		if u, err := url.Parse(downloadURL); err == nil {
			filename = path.Base(u.Path)
		}
	}
	filename = sanitizeFilename(filename)

	slicerID := strings.ToLower(strings.TrimSpace(q.Get("slicer")))
	log.Printf("open request slicer=%s url=%s filename=%s", slicerID, redactURL(downloadURL), filename)

	downloadDir := resolveDownloadDir(cfg)
	if err := os.MkdirAll(downloadDir, 0755); err != nil {
		return fmt.Errorf("create download dir: %w", err)
	}

	targetPath := uniquePath(downloadDir, filename)
	if err := downloadFile(downloadURL, targetPath); err != nil {
		return err
	}

	if slicerID == "" || slicerID == "other" {
		log.Printf("open with default app path=%s", targetPath)
		return openWithDefault(targetPath)
	}

	cmd, args := resolveSlicerCommand(slicerID, cfg)
	if cmd == "" {
		// Otherwise a slicer that isn't found looks, in the log, like one that was launched.
		log.Printf("slicer not found slicer=%s; open with default app path=%s", slicerID, targetPath)
		return openWithDefault(targetPath)
	}

	log.Printf("launch slicer command=%s args=%v", cmd, args)
	return launchCommand(cmd, args, targetPath)
}

func setupLogging(cfg Config, cfgDir string) {
	logPath := cfg.LogFile
	if logPath == "" {
		logPath = filepath.Join(cfgDir, "bridge.log")
	}
	if err := os.MkdirAll(filepath.Dir(logPath), 0755); err != nil {
		log.SetOutput(os.Stderr)
		return
	}
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		log.SetOutput(os.Stderr)
		return
	}
	log.SetOutput(f)
}

func loadConfig() (Config, string) {
	cfgDir := configDir()
	cfgPath := filepath.Join(cfgDir, "config.json")
	cfg := Config{Slicers: map[string]SlicerConfig{}}
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		return cfg, cfgDir
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, cfgDir
	}
	if cfg.Slicers == nil {
		cfg.Slicers = map[string]SlicerConfig{}
	}
	return cfg, cfgDir
}

func configDir() string {
	dir, err := os.UserConfigDir()
	if err != nil || dir == "" {
		return filepath.Join(os.TempDir(), "thingport-bridge")
	}
	return filepath.Join(dir, "thingport-bridge")
}

func resolveDownloadDir(cfg Config) string {
	if cfg.DownloadDir != "" {
		return cfg.DownloadDir
	}
	dir, err := os.UserCacheDir()
	if err != nil || dir == "" {
		return filepath.Join(os.TempDir(), "thingport-bridge")
	}
	return filepath.Join(dir, "thingport-bridge")
}

func sanitizeFilename(name string) string {
	name = strings.TrimSpace(name)
	name = filepath.Base(name)
	name = strings.Map(func(r rune) rune {
		switch r {
		case '<', '>', ':', '"', '/', '\\', '|', '?', '*':
			return -1
		}
		if r < 32 {
			return -1
		}
		return r
	}, name)
	name = strings.Trim(name, " .")
	if name == "" {
		return "model"
	}
	return name
}

func uniquePath(dir, name string) string {
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	p := filepath.Join(dir, name)
	for i := 1; fileExists(p); i++ {
		p = filepath.Join(dir, fmt.Sprintf("%s-%d%s", base, i, ext))
	}
	return p
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func downloadFile(downloadURL, targetPath string) error {
	client := &http.Client{Timeout: 5 * time.Minute}
	req, err := http.NewRequest(http.MethodGet, downloadURL, nil)
	if err != nil {
		return fmt.Errorf("request: %w", err)
	}
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("download failed: %s", res.Status)
	}
	out, err := os.Create(targetPath)
	if err != nil {
		return fmt.Errorf("create file: %w", err)
	}
	defer out.Close()
	if _, err := io.Copy(out, res.Body); err != nil {
		return fmt.Errorf("save file: %w", err)
	}
	return nil
}

func resolveSlicerCommand(id string, cfg Config) (string, []string) {
	id = strings.ToLower(strings.TrimSpace(id))
	if id == "" || id == "other" {
		return "", nil
	}

	if cfg.Slicers != nil {
		if sc, ok := cfg.Slicers[id]; ok && sc.Command != "" {
			return sc.Command, sc.Args
		}
	}

	envKey := "THINGPORT_SLICER_" + strings.ToUpper(strings.ReplaceAll(id, "-", "_"))
	if val := strings.TrimSpace(os.Getenv(envKey)); val != "" {
		return val, nil
	}

	switch runtime.GOOS {
	case "windows":
		return findWindowsCommand(id, windowsCandidates()), nil
	case "linux":
		return findLinuxCommand(id, linuxCandidates()), nil
	case "darwin":
		return findMacCommand(id, macCandidates()), nil
	default:
		return "", nil
	}
}

func findWindowsCommand(id string, candidates map[string][]string) string {
	paths := candidates[id]
	if len(paths) == 0 {
		return ""
	}
	var bases []string
	if pf := os.Getenv("ProgramFiles"); pf != "" {
		bases = append(bases, pf)
	}
	if pf86 := os.Getenv("ProgramFiles(x86)"); pf86 != "" {
		bases = append(bases, pf86)
	}
	if la := os.Getenv("LOCALAPPDATA"); la != "" {
		bases = append(bases, la, filepath.Join(la, "Programs"))
	}

	for _, rel := range paths {
		if filepath.IsAbs(rel) && fileExists(rel) {
			return rel
		}
		for _, base := range bases {
			full := filepath.Join(base, rel)
			// Cura's install directory embeds its version, so its candidate is a glob.
			if strings.Contains(rel, "*") {
				if matches, err := filepath.Glob(full); err == nil && len(matches) > 0 {
					sort.Strings(matches)
					return matches[len(matches)-1]
				}
				continue
			}
			if fileExists(full) {
				return full
			}
		}
	}
	return ""
}

func findLinuxCommand(id string, candidates map[string][]string) string {
	for _, name := range candidates[id] {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	return ""
}

// Also checks ~/Applications, a common install target that needs no admin rights.
func findMacCommand(id string, candidates map[string][]string) string {
	home, _ := os.UserHomeDir()
	for _, appPath := range candidates[id] {
		if fileExists(appPath) {
			return appPath
		}
		if home != "" && strings.HasPrefix(appPath, "/Applications/") {
			if userApp := filepath.Join(home, appPath); fileExists(userApp) {
				return userApp
			}
		}
	}
	return ""
}

func windowsCandidates() map[string][]string {
	return map[string][]string{
		// The installer ships bambu-studio.exe; BambuStudio.exe is kept in case a build names it that.
		// "/" so the test runs on any OS; Windows accepts it.
		"bambustudio": {"Bambu Studio/bambu-studio.exe", "Bambu Studio/BambuStudio.exe"},
		"orcaslicer":  {"OrcaSlicer\\OrcaSlicer.exe"},
		"prusaslicer": {"PrusaSlicer\\PrusaSlicer.exe"},
		// Globs because the dir embeds the version; renamed "Ultimaker" -> "UltiMaker" around 5.7.
		"cura": {
			"UltiMaker Cura */UltiMaker-Cura.exe",
			"Ultimaker Cura */UltiMaker-Cura.exe",
			"Ultimaker Cura */Cura.exe",
		},
		// Launched by path: its orcaslicer:// handler clashes with OrcaSlicer's. The folder name isn't
		// documented, hence the variants.
		"anycubicslicernext": {
			"AnycubicSlicerNext\\AnycubicSlicerNext.exe",
			"Anycubic Slicer Next\\AnycubicSlicerNext.exe",
			"Anycubic*/AnycubicSlicerNext.exe", // "/" in globs, like Cura's: Windows accepts it too
		},
	}
}

func linuxCandidates() map[string][]string {
	return map[string][]string{
		"bambustudio": {"bambu-studio", "BambuStudio"},
		"orcaslicer":  {"orca-slicer", "OrcaSlicer"},
		"prusaslicer": {"prusa-slicer", "PrusaSlicer"},
		// PATH only: AppImage and Flatpak builds need a config.json entry (see bridge/README.md).
		"cura":               {"cura", "UltiMaker-Cura"},
		"anycubicslicernext": {"AnycubicSlicerNext", "anycubicslicernext", "anycubic-slicer-next"},
	}
}

func macCandidates() map[string][]string {
	return map[string][]string{
		"bambustudio":        {"/Applications/BambuStudio.app"},
		"orcaslicer":         {"/Applications/OrcaSlicer.app"},
		"prusaslicer":        {"/Applications/PrusaSlicer.app", "/Applications/Original Prusa Drivers/PrusaSlicer.app"},
		"cura":               {"/Applications/UltiMaker Cura.app", "/Applications/Ultimaker Cura.app"},
		"anycubicslicernext": {"/Applications/AnycubicSlicerNext.app", "/Applications/Anycubic Slicer Next.app"},
	}
}

func launchCommand(cmd string, args []string, filePath string) error {
	if runtime.GOOS == "darwin" && strings.HasSuffix(strings.ToLower(cmd), ".app") {
		allArgs := append([]string{"-a", cmd, filePath}, args...)
		return exec.Command("open", allArgs...).Start()
	}
	allArgs := append([]string{}, args...)
	allArgs = append(allArgs, filePath)
	return exec.Command(cmd, allArgs...).Start()
}

func openWithDefault(filePath string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("cmd", "/c", "start", "", filePath).Start()
	case "linux":
		return exec.Command("xdg-open", filePath).Start()
	case "darwin":
		return exec.Command("open", filePath).Start()
	default:
		return fmt.Errorf("unsupported os: %s", runtime.GOOS)
	}
}

func redactURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	q := parsed.Query()
	if q.Has("token") {
		q.Set("token", "REDACTED")
		parsed.RawQuery = q.Encode()
	}
	return parsed.String()
}
