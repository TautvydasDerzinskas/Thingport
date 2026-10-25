// GENERATED from providers/pinshape/manifest.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
// Its logo's mark, without the wordmark: the white "p" in its blue shape, cut out so it takes the background.
import type { ProviderManifest } from "../_lib/types.generated";

export default {
  id: "pinshape",
  name: "Pinshape",
  order: 12,
  site: "https://pinshape.com",
  docsSlug: "pinshape",
  hosts: ["pinshape.com"],
  endpoints: { files: "https://mh-pinshape-private.s3.amazonaws.com" },
  brand: {
    logo: {
      viewBox: "31.2 112.7 46 46",
      color: "#46A3D8",
      path: "M47.826 153.926c-0.83-0.139-2.481-0.638-3.381-1.023l-0.88-0.377v-4.706-4.706l1.158 0.98c0.637 0.539 1.542 1.205 2.012 1.479 2.341 1.368 5.838 1.931 8.501 1.37 3.568-0.752 6.754-3.262 8.418-6.63 2.55-5.162 1.467-11.054-2.739-14.906-4.637-4.246-11.607-4.224-16.224 0.05-2.002 1.853-3.116 3.638-3.86 6.181-0.248 0.848-0.316 2.511-0.403 9.911l-0.105 8.892-1.575-1.582c-4.621-4.642-7.496-11.316-7.159-16.617 0.504-7.925 7.877-14.32 17.069-14.806 4.911-0.26 11.474 1.318 17.104 4.11 3.255 1.615 5.483 3.161 7.311 5.074 3.375 3.533 3.923 6.708 1.881 10.892-3.881 7.951-17.193 16.658-25.247 16.515-0.781-0.014-1.628-0.06-1.882-0.103zM49.954 143.727c-5.855-2.086-8.197-9.057-4.785-14.242 1.887-2.868 4.688-4.296 8.029-4.095 2.762 0.166 5.031 1.394 6.713 3.63 3.614 4.808 1.931 11.655-3.502 14.243-1.366 0.651-1.57 0.694-3.489 0.743-1.586 0.04-2.244-0.022-2.966-0.279z",
    },
    accent: "#46A3D8",
  },
  signIn: "user",
  // remember_token is Flask-Login's year-long one, which signs in on its own; session, the server-side session beside it.
  sessionCookies: { remember: "remember_token", session: "session" },
  auth: [
    {
      slot: "default",
      scope: "user",
      fields: [{ name: "session", multiline: true }],
      legacyEndpoint: { path: "pinshape-session", method: "PATCH" },
    },
  ],
  modelNoun: "models",
  helpers: { grab: "recommended", flaresolverr: "none" },
  capabilities: {
    collections: true,
    likes: true,
    profiles: false,
    paidModels: false,
    ownLists: "signIn",
    // Its model pages don't say which of its categories a model is in.
    categoryIds: "none",
    trending: { kind: "popular", moreUrl: "https://pinshape.com/items?sort=popular", rank: 12 },
  },
  examples: {
    model: "https://pinshape.com/items/111504-articulated-dragon",
    list: "https://pinshape.com/items?collection_id=187772",
    browse: "https://pinshape.com/users/…?tab=likes",
  },
  errorCodes: { session: "pinshape_session" },
  extension: { site: "optional", origins: ["*://pinshape.com/*", "*://*.pinshape.com/*"] },
} as const satisfies ProviderManifest;
