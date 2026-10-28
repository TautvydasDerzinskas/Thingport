// The OpenSCAD libraries Thingport carries, named once so both the engine and the client that talks to it can
// say what is available without either pulling the other in.

/** The library scripts Thingport carries, by the path a script includes them at ("BOSL2/std.scad"). */
export const LIBRARY_FILES = import.meta.glob("../assets/scadLibraries/**/*.scad", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;

export const libraryPath = (key: string) => key.replace("../assets/scadLibraries/", "");

/** The library folders carried here, as a script would name them: "BOSL2". */
export const SCAD_LIBRARIES = [...new Set(Object.keys(LIBRARY_FILES).map((key) => libraryPath(key).split("/")[0]))];
