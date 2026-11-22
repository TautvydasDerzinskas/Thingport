import { modelUrl, parseModelUrl } from "../providers/index.generated";

/** Provider + stable external id for a model URL, used to dedupe imports. Null if unknown. */
export function identifySourceModel(url: string): { provider: string; externalId: string } | null {
  const model = parseModelUrl(url);
  return model && { provider: model.provider, externalId: model.externalId };
}

/** Inverse of identifySourceModel, for the "Open in {Provider}" link. */
export function buildImportSourceUrl(provider: string | null, externalId: string | null): string | null {
  return provider && externalId ? modelUrl(provider, externalId) : null;
}
