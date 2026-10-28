// GENERATED from providers/owlcad/manifest.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
// Its mark, drawn rather than traced: the site's own favicon is a forty-path isometric owl that turns to mud at
// 16px, so this is the same bird as a silhouette -- tufted head, two eyes cut out -- in its amber.
import type { ProviderManifest } from "../_lib/types.generated";

export default {
  id: "owlcad",
  name: "OwlCAD",
  order: 13,
  site: "https://owlcad.com",
  docsSlug: "owlcad",
  hosts: ["owlcad.com"],
  // It is a Firebase app: its gallery is Firestore, its files Firebase Storage, and its calls one Cloud Function.
  // All three answer unauthenticated, so none of them is reached with a credential.
  endpoints: {
    api: "https://us-central1-webcad-66241.cloudfunctions.net",
    firestore: "https://firestore.googleapis.com",
    files: "https://firebasestorage.googleapis.com",
  },
  brand: {
    logo: {
      color: "#f59e0b",
      fillRule: "evenodd",
      path: "M12 2.1c-2.1 0-4 .7-5.6 1.9L2.6 1.5l1 5.1A9.3 9.3 0 0 0 2.7 11c0 5.6 4.2 10.1 9.3 10.1S21.3 16.6 21.3 11c0-1.6-.3-3-.9-4.4l1-5.1-3.8 2.5A9 9 0 0 0 12 2.1ZM8.8 8a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm6.4 0a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z",
    },
    accent: "#f59e0b",
  },
  // Nothing is kept for it: its gallery, its files and its one call all answer without a sign-in.
  signIn: "none",
  auth: [],
  modelNoun: "models",
  // Its library parts import server-side; its CAD projects are a script, not a mesh, and only its own editor can
  // turn one into a file, so those go through Grab (see the backend folder's index.ts).
  helpers: { grab: "recommended", flaresolverr: "none" },
  capabilities: {
    collections: false,
    likes: false,
    // It has no author pages at all -- only /gallery/<id>/<slug>, /gallery/category/<slug> and
    // /gallery/ai-generated -- so there is nothing to read a creator from.
    profiles: false,
    paidModels: false,
    // Unused: with no collections and no likes there is no Browse tab to find a user's own lists in.
    ownLists: "signIn",
    // Its categories have no ids: a model carries its category's label ("Printer Parts"), which is a one-segment path.
    categoryIds: "path",
    // Nothing to rank: no gallery item is featured, and the whole gallery's highest like count is 1.
    trending: false,
  },
  examples: {
    model: "https://owlcad.com/gallery/0f7d8172-a9b7-4de1-9b1b-5a8c255ac274/apex-evo-hd-gopro-mount",
    list: "https://owlcad.com/gallery/category/printer-parts",
    browse: "https://owlcad.com/gallery",
  },
  errorCodes: { needsGrab: "owlcad_needs_grab" },
  extension: { site: "optional", origins: ["*://owlcad.com/*", "*://*.owlcad.com/*"] },
} as const satisfies ProviderManifest;
