import { studioApi } from "../../api/studio";
import { featureById, inputsOf, type MeshData, type StudioDocument } from "../../studio/document";
import { decodeMesh } from "../../studio/meshAsset";

// The meshes designs imported, each fetched once: an asset never changes, so a copy in memory is always right.
const loading = new Map<string, Promise<MeshData | null>>();

function load(designId: string, assetId: string): Promise<MeshData | null> {
  const key = `${designId}/${assetId}`;
  let pending = loading.get(key);
  if (!pending) {
    pending = studioApi
      .asset(designId, assetId)
      .then(decodeMesh)
      .catch(() => {
        // Not kept, so the next look tries again.
        loading.delete(key);
        return null;
      });
    loading.set(key, pending);
  }
  return pending;
}

/** Geometry for the requested bodies and what they depend on. A whole-design operation omits ids. */
export async function designMeshes(
  designId: string,
  doc: StudioDocument,
  ids?: readonly string[],
): Promise<Map<string, MeshData>> {
  const visited = new Set<string>();
  const assets = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const feature = featureById(doc, id);
    if (!feature) return;
    if (feature.type === "mesh") assets.add(feature.asset_id);
    inputsOf(feature).forEach(visit);
  };
  (ids ?? doc.features.map((feature) => feature.id)).forEach(visit);
  const loaded = new Map<string, MeshData>();
  await Promise.all(
    [...assets].map(async (id) => {
      const mesh = await load(designId, id);
      if (mesh) loaded.set(id, mesh);
    }),
  );
  return loaded;
}
