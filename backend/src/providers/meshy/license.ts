import type { ProviderLicense } from "../../services/licenseCatalog";
import { asRecord, asText } from "../../services/trendingModel";

// Meshy's terms put everything posted to its community under CC0, the models generated on it included, so a community
// post's licence needs no field -- except a post of a model someone uploaded rather than generated, which keeps the
// licence its uploader chose for it. A generation of one's own keeps the one it was made under: CC BY 4.0 on the free
// plan, private on a paid one, CC0 once it's published.
const LICENSES: Record<string, string> = {
  cc0: "CC0-1.0",
  "cc-by-4.0": "CC-BY-4.0",
  private: "meshy-private",
};

function mapped(raw: string): ProviderLicense {
  const id = LICENSES[raw] ?? null;
  return id ? { id, raw } : { id: null, raw, label: raw };
}

/** A generation's licence by its task's `license`; null for one that names none. */
export function meshyTaskLicense(value: unknown): ProviderLicense | null {
  const raw = asText(value);
  return raw ? mapped(raw) : null;
}

/** A community post's licence, by its model items: the licence an uploaded model's stage was given, or CC0. */
export function meshyPostLicense(models: Record<string, unknown>[]): ProviderLicense {
  for (const item of models) {
    const stages = Object.values(asRecord(item.modelArgs) ?? {}).map(asRecord);
    const upload = stages.find((stage) => asText(stage?.modelId)?.startsWith("uploads/"));
    const raw = asText(upload?.license);
    if (raw) return mapped(raw);
  }
  return { id: "CC0-1.0", raw: "" };
}
