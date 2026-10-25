// The Thingport Bridge helper app's protocol (see bridge/README.md).
const BRIDGE_SCHEME = "thingport";

// bambustudio:// and prusaslicer:// only open files from allowlisted domains, and Cura's cura://
// registration is unreliable, so the Bridge downloads the file and launches them directly.
// Anycubic Slicer Next registers OrcaSlicer's orcaslicer:// protocol, so with both installed only
// one would get the link; the Bridge launches it by path instead.
const BRIDGED_SLICERS = new Set(["bambustudio", "prusaslicer", "cura", "anycubicslicernext"]);

export function isBridgedSlicer(slicerId: string): boolean {
  return BRIDGED_SLICERS.has(slicerId);
}

// Elegoo Slicer and Snapmaker Orca launch directly like OrcaSlicer, but name the file after the
// URL's last segment, so each gets the filename the way its handler reads it.
function withFilenameHint(slicerId: string, fileUrl: string, filename: string): { fileUrl: string; extra: string } {
  if (slicerId === "elegooslicer") {
    const url = new URL(fileUrl, window.location.origin);
    url.searchParams.set("filename", filename);
    return { fileUrl: url.toString(), extra: "" };
  }
  if (slicerId === "snapmaker-orca") {
    return { fileUrl, extra: `&name=${encodeURIComponent(filename)}` };
  }
  return { fileUrl, extra: "" };
}

// Only for SLICER_OPTIONS ids that register a protocol; never "other".
export function slicerLaunchUrl(slicerId: string, fileUrl: string, filename?: string): string {
  if (BRIDGED_SLICERS.has(slicerId)) {
    const params = new URLSearchParams({ url: fileUrl, slicer: slicerId });
    if (filename) params.set("filename", filename);
    return `${BRIDGE_SCHEME}://open?${params.toString()}`;
  }
  // eufyMake Studio is a PrusaSlicer fork without its Printables-only check; its link is the one its site's own
  // "Open in slicer" button makes, the file named after the link's last segment or `name`.
  if (slicerId === "eufystudio3d") {
    const name = filename ? `&name=${encodeURIComponent(filename)}` : "";
    return `eufystudio3d://open/?file=${encodeURIComponent(fileUrl)}${name}`;
  }
  const hinted = filename ? withFilenameHint(slicerId, fileUrl, filename) : { fileUrl, extra: "" };
  return `${slicerId}://open?file=${encodeURIComponent(hinted.fileUrl)}${hinted.extra}`;
}
