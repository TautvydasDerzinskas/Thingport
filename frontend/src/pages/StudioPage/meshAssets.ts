import { studioApi } from "../../api/studio";
import type { MeshData, StudioDocument } from "../../studio/document";
import type { MeshLookup } from "../../studio/geometry";
import { decodeMesh } from "../../studio/meshAsset";

// The meshes designs imported, each fetched once: an asset never changes, so a copy in memory is always right.
const loading = new Map<string, Promise<MeshData | null>>();
const loaded = new Map<string, MeshData>();

function load(designId: string, assetId: string): Promise<MeshData | null> {
  const key = `${designId}/${assetId}`;
  let pending = loading.get(key);
  if (!pending) {
    pending = studioApi.asset(designId, assetId).then(
      (bytes) => {
        const mesh = decodeMesh(bytes);
        loaded.set(key, mesh);
        return mesh;
      },
      () => {
        // Not kept, so the next look tries again.
        loading.delete(key);
        return null;
      },
    );
    loading.set(key, pending);
  }
  return pending;
}

/** Every mesh the design imported, loaded, for evaluateDesign. One that couldn't be fetched is left out. */
export async function designMeshes(designId: string, doc: StudioDocument): Promise<MeshLookup> {
  const assets = doc.features.flatMap((feature) => (feature.type === "mesh" ? [feature.asset_id] : []));
  await Promise.all(assets.map((assetId) => load(designId, assetId)));
  return (assetId) => loaded.get(`${designId}/${assetId}`);
}
