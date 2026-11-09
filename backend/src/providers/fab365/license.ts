import type { ProviderLicense } from "../../services/licenseCatalog";

// Fab365 has no licence of a model's own: every model, free or paid, is under the same terms of service -- for personal
// use only, the copyright the designer's, no commercial use and no redistributing the files. So nothing needs reading.
const TERMS_URL = "https://fab365.net/terms";

/** The licence of every Fab365 model. */
export function fab365License(): ProviderLicense {
  return { id: "fab365-personal", raw: TERMS_URL };
}

/** An older import's licence, which needs no request. */
export async function readFab365License(): Promise<ProviderLicense> {
  return fab365License();
}
