// What Grab does on owlcad.com pages: starts the waiting CAD projects' exports. There is no sign-in to send on --
// OwlCAD needs none for anything Thingport reads.

import { providerEnabled } from "../../content/providerSettings";
import { send } from "../../shared/messages";
import { MANIFESTS } from "../index.generated";

/** Any owlcad.com page will do: the export happens in a tab of its own, opened on the model's editor link, not on
 *  the page the user is looking at. Not run on the editor itself, so an export Grab opened can't set another off. */
export async function syncOwlcad(): Promise<void> {
  if (!(await providerEnabled(MANIFESTS.owlcad.id))) return;
  if (new URLSearchParams(window.location.search).has("shared")) return;
  await send("RUN_OWLCAD_WAITING");
}
