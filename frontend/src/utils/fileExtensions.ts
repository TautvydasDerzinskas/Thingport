/** Lowercased file extension without the leading dot, e.g. "stl" for "model.STL". */
export function extOf(name: string): string {
  const match = /\.([^.]+)$/.exec(name || "");
  return (match?.[1] || "").toLowerCase();
}

/** A file's name with its folder before it ("docs/guide.pdf"), or the name alone at the top: two of one name in
 *  different folders are told apart by it. */
export function inFolder(name: string, folder?: string | null): string {
  return folder ? `${folder}/${name}` : name;
}

/** A name with nothing before the dot is kept whole. */
export function stemOf(name: string): string {
  const stem = (name || "").replace(/\.[^.]+$/, "");
  return stem || name || "";
}

/** A file's extension with its dot, as the server reads one (Node's path.extname): none for a name that is all
 *  extension (".pdf"), which it serves as a file with no type. */
export function extnameOf(name: string): string {
  const base = (name || "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

/** `name` with `from`'s extension where it has none of its own, as a stored file's rename keeps it. */
export function withExtensionOf(name: string, from: string): string {
  return extnameOf(name) ? name : `${name}${extnameOf(from)}`;
}
