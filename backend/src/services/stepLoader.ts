import fs from "node:fs/promises";

// Tessellates a STEP file with the OCCT kernel (occt-import-js, the same wasm build the browser's 3D viewer
// loads), so the server can draw a picture of a CAD file and check it for printability. STEP holds surfaces
// rather than triangles, so there is nothing to read out of one without a kernel.
//
// Runs in a worker thread (modelPreviewWorker.ts); keep it free of config/db imports.

// The kernel writes a line per problem it finds, so a garbled file can produce thousands; the first few say enough.
const MAX_KERNEL_NOTES = 5;
const MAX_KERNEL_NOTES_CHARS = 500;

export type StepMesh = {
  positions: Float32Array;
  /** Null for a part the kernel handed over as loose triangles. */
  indices: Uint32Array | null;
  /** Linear RGB in 0..1, which is what three works in; null where the file named no colour for this part. */
  color: [number, number, number] | null;
};

function toFloat32(values: ArrayLike<number>): Float32Array {
  return values instanceof Float32Array ? values : Float32Array.from(values as ArrayLike<number>);
}

function toUint32(values: ArrayLike<number>): Uint32Array {
  return values instanceof Uint32Array ? values : Uint32Array.from(values as ArrayLike<number>);
}

/**
 * Every part in the file, Z-up as CAD and print files are. Empty for a file the kernel read but found nothing
 * to draw in; throws on one it couldn't read at all.
 *
 * Tessellated with the kernel's own defaults, the same ones the 3D viewer passes, so the picture the server
 * draws is of the shape the viewer shows.
 */
export async function loadStepMeshes(srcPath: string): Promise<StepMesh[]> {
  const initOcct = (await import("occt-import-js")).default;
  // The kernel narrates a file it dislikes straight to stdout/stderr ("**** ERR StepFile ..."), which would reach
  // the server log with nothing to say which model it was about. The thrown error below carries that instead.
  const notes: string[] = [];
  const note = (line: string) => {
    if (notes.length < MAX_KERNEL_NOTES) notes.push(line);
  };
  const occt = await initOcct({ print: note, printErr: note });
  const file = await fs.readFile(srcPath);
  const result = occt.ReadStepFile(new Uint8Array(file.buffer, file.byteOffset, file.byteLength), null);
  if (!result.success) {
    const said = notes.join(" ").trim().slice(0, MAX_KERNEL_NOTES_CHARS);
    throw new Error(`the CAD kernel couldn't read this STEP file${said ? `: ${said}` : ""}`);
  }
  const meshes: StepMesh[] = [];
  for (const mesh of result.meshes) {
    const positions = mesh.attributes?.position?.array;
    if (!positions?.length) continue;
    const indices = mesh.index?.array;
    meshes.push({
      positions: toFloat32(positions),
      indices: indices?.length ? toUint32(indices) : null,
      color: mesh.color ?? null,
    });
  }
  return meshes;
}
