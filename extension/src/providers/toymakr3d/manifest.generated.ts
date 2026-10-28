// GENERATED from providers/toymakr3d/manifest.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
// Its logo's mark, without the wordmark beside it: the gold mecha head over the dark shield it sits on, its eyes and
// grille cut out so they take the shield. The shield is the base path, so on a dark background it recedes and leaves
// the head, as eufyMake's hexagon does.
import type { ProviderManifest } from "../_lib/types.generated";

export default {
  id: "toymakr3d",
  name: "Toymakr3D",
  order: 14,
  site: "https://www.toymakr3d.com",
  docsSlug: "toymakr3d",
  hosts: ["toymakr3d.com"],
  endpoints: { files: "https://cdn.toymakr3d.com" },
  brand: {
    logo: {
      color: "#141414",
      path: "M2.2 3 L21.8 3 L21.8 11.8 L12 22.6 L2.2 11.8 Z",
      layers: [
        {
          d: "M12 3.28 L13.18 6.98 L15.26 4.91 L16.14 7.57 L17.62 7.87 L17.62 9.05 L19.25 9.49 L19.25 12.6 L17.62 13.05 L17.18 15.12 L12 18.52 L6.82 15.12 L6.38 13.05 L4.75 12.6 L4.75 9.49 L6.38 9.05 L6.38 7.87 L7.86 7.57 L8.74 4.91 L10.82 6.98 Z M8 10.09 L10.82 10.68 L10.52 12.45 L8 11.86 Z M16 10.09 L13.18 10.68 L13.48 12.45 L16 11.86 Z M9.34 13.79 L14.66 13.79 L14.22 14.97 L13.33 14.97 L13.33 14.45 L12.44 14.45 L12.44 14.97 L11.56 14.97 L11.56 14.45 L10.67 14.45 L10.67 14.97 L9.78 14.97 Z",
          color: "#FCD333",
          fillRule: "evenodd",
        },
      ],
    },
    accent: "#FCD333",
  },
  signIn: "user",
  // Laravel's pair: the session cookie, and the remember-me cookie whose name ends in a hash of the site's app key,
  // so `remember` is the prefix to look for rather than the whole name.
  sessionCookies: { remember: "remember_web_", session: "toymakr3dcom_session" },
  auth: [{ slot: "default", scope: "user", fields: [{ name: "session", multiline: true }] }],
  modelNoun: "models",
  helpers: { grab: "recommended", flaresolverr: "none" },
  capabilities: {
    collections: false,
    likes: true,
    profiles: false,
    paidModels: true,
    ownLists: "signIn",
    categoryIds: "number",
    trending: { kind: "popular", moreUrl: "https://www.toymakr3d.com/by-category/most-popular", rank: 13 },
  },
  examples: {
    model: "https://www.toymakr3d.com/product/8-transformable-sofa-robot",
    list: "https://www.toymakr3d.com/like-product",
    browse: "https://www.toymakr3d.com/like-product",
  },
  errorCodes: { session: "toymakr3d_session" },
  extension: { site: "optional", origins: ["*://toymakr3d.com/*", "*://*.toymakr3d.com/*"] },
} as const satisfies ProviderManifest;
