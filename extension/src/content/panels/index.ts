import { ctx } from "../context";
import { loadBatchEntries } from "./batch";
import { loadMakerworldGuidedCollection } from "../../providers/makerworld/collectionPanel";
import { loadSingleItem } from "./single";
import { MANIFESTS } from "../../providers/index.generated";

export async function loadPanel(): Promise<void> {
  const { kind, provider } = ctx().classification;
  if (kind === "single") await loadSingleItem();
  else if (provider === MANIFESTS.makerworld.id) await loadMakerworldGuidedCollection();
  else await loadBatchEntries();
}
