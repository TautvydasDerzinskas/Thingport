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
	"strconv"
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

// For slicers Thingport can't hand off to directly: bambustudio:// and prusaslicer:// only accept
// allowlisted domains, and Cura's cura:// registration is unreliable. OrcaSlicer and the others with
// a handler of their own come here only when the user sends them through the Bridge (Configuration >
// Slicer in Thingport), for when one can't download from the instance itself.
const scheme = "thingport"

// Release builds set it with -ldflags "-X main.version=...".
var version = "dev"

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
	case "-v", "--version":
		fmt.Println(version)
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
	fmt.Println("  thingport-bridge --version")
	fmt.Println("  thingport-bridge <thingport://open?...>")
}

func runInstallAndReport() {
	target, err := installSelf()
	if err != nil {
		fmt.Printf("Install failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Installed Thingport Bridge %s at %s\n", version, target)
	fmt.Println("You can now use \"Open in Bambu Studio\" from Thingport.")
}

func handleProtocol(raw string, cfg Config) error {
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("parse url: %w", scrubURL(err))
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
	// Any website can make a thingport:// link, and a file that isn't a model may be a program the OS
	// runs when it's opened. Thingport only ever hands over models, so refuse the rest before fetching.
	if !isModelFile(filename) {
		return fmt.Errorf("refused %q: not a model file", filename)
	}

	slicerID := strings.ToLower(strings.TrimSpace(q.Get("slicer")))
	log.Printf("open request version=%s slicer=%s url=%s filename=%s", version, slicerID, redactURL(downloadURL), filename)

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

// isModelFile is true for the files Thingport hands to a slicer: models, laser projects and sliced prints.
func isModelFile(filePath string) bool {
	switch strings.ToLower(filepath.Ext(filePath)) {
	case ".stl", ".3mf", ".step", ".stp", ".obj", ".glb", ".gltf",
		".f3d", ".lbrn", ".lbrn2", ".gcode", ".bgcode":
		return true
	default:
		return false
	}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func downloadFile(downloadURL, targetPath string) error {
	client := &http.Client{Timeout: 5 * time.Minute}
	req, err := http.NewRequest(http.MethodGet, downloadURL, nil)
	if err != nil {
		return fmt.Errorf("request: %w", scrubURL(err))
	}
	// Thingport tells the user when a newer Bridge is out (bridgeUpdateService).
	req.Header.Set("User-Agent", userAgent())
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("download: %w", scrubURL(err))
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

func userAgent() string {
	return fmt.Sprintf("Thingport-Bridge/%s (%s)", version, runtime.GOOS)
}

// scrubURL redacts the URL a *url.Error repeats (net/http's and url.Parse's errors do), so a
// /api/t/<session>/ sign-in doesn't reach the log, while the cause itself (a certificate the system
// doesn't trust, say) still does.
func scrubURL(err error) error {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		urlErr.URL = redactURL(urlErr.URL)
	}
	return err
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
			// Some install directories embed the version, so their candidates are globs.
			if strings.Contains(rel, "*") {
				if matches, err := filepath.Glob(full); err == nil && len(matches) > 0 {
					return newestVersion(matches)
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

// newestVersion picks the newest of several versioned installs: "Cura 5.10" over "Cura 5.9", which a
// plain sort gets the wrong way round.
func newestVersion(paths []string) string {
	sorted := append([]string(nil), paths...)
	sort.SliceStable(sorted, func(i, j int) bool { return versionLess(sorted[i], sorted[j]) })
	return sorted[len(sorted)-1]
}

// versionLess compares runs of digits as numbers and everything else as text.
func versionLess(a, b string) bool {
	for a != "" && b != "" {
		ca, cb := a[:runEnd(a)], b[:runEnd(b)]
		if ca != cb {
			na, errA := strconv.Atoi(ca)
			nb, errB := strconv.Atoi(cb)
			if errA != nil || errB != nil {
				return ca < cb
			}
			if na != nb {
				return na < nb
			}
		}
		a, b = a[len(ca):], b[len(cb):]
	}
	return len(a) < len(b)
}

// runEnd is the length of the run of digits, or of non-digits, that s starts with.
func runEnd(s string) int {
	isDigit := func(c byte) bool { return c >= '0' && c <= '9' }
	digits := isDigit(s[0])
	i := 1
	for i < len(s) && isDigit(s[i]) == digits {
		i++
	}
	return i
}

// Also looks where Flatpak exports its apps' commands, which a desktop session may not have on PATH.
func findLinuxCommand(id string, candidates map[string][]string) string {
	var dirs []string
	if home, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(home, ".local/share/flatpak/exports/bin"))
	}
	dirs = append(dirs, "/var/lib/flatpak/exports/bin")
	for _, name := range candidates[id] {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
		for _, dir := range dirs {
			if p, err := exec.LookPath(filepath.Join(dir, name)); err == nil {
				return p
			}
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
		"orcaslicer":  {"OrcaSlicer/orca-slicer.exe"},
		"prusaslicer": {"PrusaSlicer\\PrusaSlicer.exe"},
		// The folder carries the version: Creality\Creality Print 7.3 for 6.x and 7.x, Creality Print 5.1
		// for 5.x.
		"crealityprintlink": {
			"Creality/Creality Print */CrealityPrint.exe",
			"Creality Print */CrealityPrint.exe",
		},
		"elegooslicer":   {"ElegooSlicer/elegoo-slicer.exe"},
		"snapmaker-orca": {"Snapmaker_Orca/snapmaker-orca.exe"},
		// Under LOCALAPPDATA. Not "eufyMake Studio\eufyMake Studio.exe": 1.5.26 used it, but so does
		// eufyMake's separate app for its UV printer.
		"eufystudio3d": {"eufyMake Studio 3D/eufymake studio.exe", "AnkerMake Studio/AnkerMake Studio.exe"},
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
		// Flatpak app ids are the commands Flatpak exports; each of these has the home folder, where the
		// downloads are. The old OrcaSlicer id is its GitHub builds' up to 2.3.1.
		"orcaslicer":  {"orca-slicer", "OrcaSlicer", "com.orcaslicer.OrcaSlicer", "io.github.softfever.OrcaSlicer"},
		"prusaslicer": {"prusa-slicer", "PrusaSlicer"},
		// PATH only: AppImage and Flatpak builds need a config.json entry (see bridge/README.md).
		"cura":               {"cura", "UltiMaker-Cura"},
		"anycubicslicernext": {"AnycubicSlicerNext", "anycubicslicernext", "anycubic-slicer-next"},
		"crealityprintlink":  {"CrealityPrint", "creality-print", "io.github.crealityofficial.CrealityPrint"},
		"elegooslicer":       {"elegoo-slicer"},
		"snapmaker-orca":     {"snapmaker-orca", "io.github.Snapmaker.Snapmaker_Orca"},
	}
}

func macCandidates() map[string][]string {
	return map[string][]string{
		"bambustudio":        {"/Applications/BambuStudio.app"},
		"orcaslicer":         {"/Applications/OrcaSlicer.app"},
		"prusaslicer":        {"/Applications/PrusaSlicer.app", "/Applications/Original Prusa Drivers/PrusaSlicer.app"},
		"cura":               {"/Applications/UltiMaker Cura.app", "/Applications/Ultimaker Cura.app"},
		"anycubicslicernext": {"/Applications/AnycubicSlicerNext.app", "/Applications/Anycubic Slicer Next.app"},
		"crealityprintlink":  {"/Applications/Creality Print.app"},
		"elegooslicer":       {"/Applications/ElegooSlicer.app"},
		"snapmaker-orca":     {"/Applications/Snapmaker Orca.app"},
		// Its earlier names after them. Its UV printer's app is "Anker Make Studio.app", with a space.
		"eufystudio3d": {
			"/Applications/eufyMake Studio 3D.app",
			"/Applications/eufyMake Studio.app",
			"/Applications/AnkerMake Studio.app",
		},
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
		return openWithDefaultWindows(filePath)
	case "linux":
		return exec.Command("xdg-open", filePath).Start()
	case "darwin":
		return exec.Command("open", filePath).Start()
	default:
		return fmt.Errorf("unsupported os: %s", runtime.GOOS)
	}
}

// redactURL scrubs every embedded /api/t/<credential>/ path and the token query parameter.
func redactURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "[invalid URL]"
	}
	// A /api/t/<JWT>/ segment is a signed session credential, like ?token=.
	segments := strings.Split(parsed.Path, "/")
	original := append([]string(nil), segments...)
	changed := false
	for i := 0; i+2 < len(original); i++ {
		if original[i] == "api" && original[i+1] == "t" && original[i+2] != "" {
			segments[i+2] = "REDACTED"
			changed = true
		}
	}
	if changed {
		parsed.Path = strings.Join(segments, "/")
		parsed.RawPath = ""
	}
	if parsed.User != nil {
		parsed.User = url.User("REDACTED")
	}
	q := parsed.Query()
	if q.Has("token") {
		q.Set("token", "REDACTED")
		parsed.RawQuery = q.Encode()
	}
	return parsed.String()
}
