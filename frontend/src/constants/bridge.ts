// The bridge-latest release always holds the newest Bridge build. Not /releases/latest: that slot is
// repo-wide, and the frontend, backend and extension releases can take it.
const BRIDGE_RELEASES_BASE = "https://github.com/TautvydasDerzinskas/Thingport/releases/download/bridge-latest";

export type BridgeDownload = { os: "windows" | "macos" | "linux"; label: string; asset: string };

export const BRIDGE_DOWNLOADS: BridgeDownload[] = [
  { os: "windows", label: "Windows", asset: "thingport-bridge-windows-amd64.exe" },
  { os: "macos", label: "macOS", asset: "thingport-bridge-macos" },
  { os: "linux", label: "Linux", asset: "thingport-bridge-linux-amd64" },
];

export function bridgeDownloadUrl(asset: string): string {
  return `${BRIDGE_RELEASES_BASE}/${asset}`;
}
