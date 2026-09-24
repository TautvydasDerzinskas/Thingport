/** Lowercased file extension without the leading dot, e.g. "stl" for "model.STL". */
export function extOf(name: string): string {
  const match = /\.([^.]+)$/.exec(name || "");
  return (match?.[1] || "").toLowerCase();
}

/** The filename without its extension, e.g. "Body" for "Body.stl" -- a file's display name where
 *  the type is shown separately. A dotfile-style name with nothing before the dot is kept whole. */
export function stemOf(name: string): string {
  const stem = (name || "").replace(/\.[^.]+$/, "");
  return stem || name || "";
}
