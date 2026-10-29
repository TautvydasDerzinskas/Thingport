declare module "occt-import-js" {
  type OcctArray = { array: ArrayLike<number> };
  type OcctMesh = {
    name?: string;
    /** Linear RGB in 0..1, as OCCT stores colours; absent where the file named none for this part. */
    color?: [number, number, number];
    attributes: { position?: OcctArray; normal?: OcctArray };
    index?: OcctArray;
  };
  type OcctModule = {
    ReadStepFile(buffer: Uint8Array, params: Record<string, unknown> | null): { success: boolean; meshes: OcctMesh[] };
  };
  export default function initOcct(options?: {
    locateFile?: (file: string) => string;
    /** Emscripten's stdout and stderr; both go to the console unless they're given somewhere else. */
    print?: (line: string) => void;
    printErr?: (line: string) => void;
  }): Promise<OcctModule>;
}
