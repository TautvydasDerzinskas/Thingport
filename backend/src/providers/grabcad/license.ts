import type { ProviderLicense } from "../../services/licenseCatalog";

// GrabCAD's models carry no licence of their own: every one is shared under its terms of use, whose cross licence
// lets each member use and change it for their own non-commercial, internal use.

/** Any GrabCAD model's licence. */
export function grabcadLicense(): ProviderLicense {
  return { id: "grabcad-terms", raw: "" };
}

/** An older import's licence, the same for every model: no request needed. */
export async function readGrabcadLicense(
  _userId: string,
  _slug: string,
  _stored: { notes: string | null },
): Promise<ProviderLicense | null> {
  return grabcadLicense();
}
