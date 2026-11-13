// Shrinks a 3D preview to about a fifth of its size: positions stored as 16-bit integers across each mesh's bounds
// (KHR_mesh_quantization; a 256 mm part steps by 0.004 mm, finer than the viewer shows), then packed with meshopt
// (EXT_meshopt_compression), which three's GLTFLoader reads with its MeshoptDecoder. Packing runs in the render worker.

const MESHOPT = "EXT_meshopt_compression";

export async function compressGlb(input: Uint8Array): Promise<Uint8Array> {
  const [{ Logger, NodeIO }, { EXTMeshoptCompression, KHRMeshQuantization }, { quantize }, meshopt] = await Promise.all(
    [
      import("@gltf-transform/core"),
      import("@gltf-transform/extensions"),
      import("@gltf-transform/functions"),
      import("meshoptimizer"),
    ],
  );
  await Promise.all([meshopt.MeshoptEncoder.ready, meshopt.MeshoptDecoder.ready]);
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ "meshopt.encoder": meshopt.MeshoptEncoder, "meshopt.decoder": meshopt.MeshoptDecoder });
  const doc = await io.readBinary(input);
  doc.setLogger(new Logger(Logger.Verbosity.SILENT));
  await doc.transform(quantize({ quantizePosition: 16 }));
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  return io.writeBinary(doc);
}

/** Whether a GLB's JSON (its first chunk) says it's packed with meshopt already. */
export function isCompressedGltf(json: { extensionsUsed?: string[] }): boolean {
  return json.extensionsUsed?.includes(MESHOPT) ?? false;
}
