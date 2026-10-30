// Types for the vendored Emscripten loader beside this file, which ships none. Only what sdk/openscad.ts calls
// is described; the module itself carries far more.
declare const OpenSCAD: (options: Record<string, unknown>) => Promise<unknown>;
export default OpenSCAD;
