// GENERATED from providers/voxelshare/manifest.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
// Its mark: two chevrons stacked into a cube's corner, the upper one in its blue, the lower in its dark ink (here the
// text colour, so it reads on either theme), from its wordmark. Its pages' buttons are a lighter blue, close to it.
import type { ProviderManifest } from "../_lib/types.generated";

export default {
  id: "voxelshare",
  name: "VoxelShare",
  order: 23,
  site: "https://www.voxelshare.com",
  docsSlug: "voxelshare",
  hosts: ["voxelshare.com"],
  // Its pages' API, which the sign-in goes to; the files are signed links on its image host, which need none.
  credentialHosts: { "voxelshare-api": { exact: ["api.voxelshare.com"] } },
  endpoints: { api: "https://api.voxelshare.com/api", files: "https://webimage.voxelshare.com" },
  brand: {
    logo: {
      viewBox: "0 0 24.85 28",
      color: "currentColor",
      path: "M16.569 12.445v9.526L8.281 28 0 21.971v-9.526l8.281 6.026z",
      layers: [{ d: "M24.85 6.026v9.529L16.569 9.529l-8.285 6.026V6.026L16.569 0z", color: "#00A0E9" }],
    },
    accent: "#00A0E9",
  },
  // Its models, their print profiles and files, its listings and anyone's public collections are anyone's to read;
  // the user's own collections and likes need their sign-in.
  signIn: "userOptional",
  // The site's sign-in is this one cookie, a token good for 31 days that its pages send as a Bearer token.
  sessionCookies: { token: "token" },
  auth: [{ slot: "default", scope: "user", fields: [{ name: "token", multiline: true }] }],
  modelNoun: "models",
  helpers: { grab: "recommended", flaresolverr: "none" },
  slicers: ["orca-flashforge"],
  capabilities: {
    collections: true,
    likes: true,
    profiles: true,
    paidModels: false,
    ownLists: "signIn",
    categoryIds: "number",
    trending: { kind: "trending", moreUrl: "https://www.voxelshare.com/en/home", rank: 22 },
    // Flashforge's slicers write OrcaSlicer's kind of Bambu project, which the site takes for a print profile.
    adapted3mfs: ["bambu"],
  },
  examples: {
    model: "https://www.voxelshare.com/en/models/8242660-flexi-mechanical-dragon",
    list: "https://www.voxelshare.com/en/collection/664950-must-have-high-quality-models",
    browse: "https://www.voxelshare.com/en/print_list",
  },
  errorCodes: { session: "voxelshare_session" },
  extension: { site: "optional", origins: ["*://www.voxelshare.com/*"] },
} as const satisfies ProviderManifest;
