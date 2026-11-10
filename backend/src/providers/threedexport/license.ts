import type { ProviderLicense } from "../../services/licenseCatalog";

// A model's page names no licence of its own: a free one is royalty free, and a paid one is sold under the Basic
// licence or, for twice the price, the Extended one, whichever the buyer picks. Its author may opt out of AI training,
// which the page notes beside the price. A bought model is kept as Basic, the one it's sold with: which of the two a
// buyer paid for, the model's page doesn't say.

/** A model's licence, by its price and whether its page says "No AI Training". */
export function threedexportLicense(price: number, noAi: boolean): ProviderLicense {
  const base = price > 0 ? "basic" : "royalty-free";
  return { id: `3dexport-${base}${noAi ? "-no-ai" : ""}`, raw: `${base}${noAi ? ", no AI training" : ""}` };
}
