import type { ProviderLicense } from "../../services/licenseCatalog";

// PIXUP has no licence of a model's own: every model's page, free or paid, says the same (the copyright stays the
// designer's, and the model is for private use only, under its terms of service), with that link as the licence in
// its structured data. So nothing needs reading, and nothing should be: the terms forbid crawling the site.
const TERMS_URL = "https://pixup3d.com/en/term_service";

/** The licence of every PIXUP model. */
export function pixup3dLicense(): ProviderLicense {
  return { id: "pixup3d-private", raw: TERMS_URL };
}

/** An older import's licence, which needs no request. */
export async function readPixup3dLicense(): Promise<ProviderLicense> {
  return pixup3dLicense();
}
