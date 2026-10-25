// GENERATED from providers/thangs/manifest.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
// Its yellow is too light for white text, so the chip's label is dark in both themes.
import type { ProviderManifest } from "../_lib/types.generated";

export default {
  id: "thangs",
  name: "Thangs",
  order: 9,
  site: "https://thangs.com",
  docsSlug: "thangs",
  hosts: ["thangs.com"],
  brand: {
    logo: {
      color: "#FFBC00",
      path: "M20.18 13.902a1.902 1.902 0 1 1 0-3.804 1.902 1.902 0 0 1 0 3.804m0-5.722A3.82 3.82 0 0 0 16.36 12v3.82h3.82a3.82 3.82 0 1 0 0-7.64m-8.656 5.722A1.907 1.907 0 0 1 9.611 12c0-1.05.857-1.902 1.913-1.902s1.913.852 1.913 1.902c0 1.05-.857 1.902-1.913 1.902m-7.683 0A1.907 1.907 0 0 1 1.928 12c0-1.05.857-1.902 1.913-1.902 1.057 0 1.913.852 1.913 1.902 0 1.05-.856 1.902-1.913 1.902m11.514-2.107-.002-.032a3.76 3.76 0 0 0-.04-.37l-.004-.019a3.693 3.693 0 0 0-.081-.373V11a3.836 3.836 0 0 0-3.704-2.82H3.84a3.833 3.833 0 0 0-3.794 3.254l-.001.008c-.018.118-.03.236-.036.357l-.002.02v.016C.006 11.89 0 11.945 0 12c0 .07.007.137.01.206l.002.032c.008.124.021.248.041.37l.003.018a3.833 3.833 0 0 0 3.786 3.194h11.523V12c0-.07-.006-.137-.01-.205",
    },
    chip: { bg: "#FFBC00", fg: "black" },
    accent: "#FFBC00",
  },
  signIn: "user",
  sessionCookies: { token: "accessToken", refresh: "refreshToken" },
  auth: [
    {
      slot: "default",
      scope: "user",
      fields: [{ name: "token", multiline: true }],
      legacyEndpoint: { path: "thangs-session", method: "PATCH" },
    },
  ],
  modelNoun: "models",
  helpers: { grab: "recommended", flaresolverr: "optional" },
  browserFetch: true,
  capabilities: {
    collections: true,
    likes: true,
    profiles: false,
    paidModels: true,
    ownLists: "signIn",
    categoryIds: "path",
    trending: { kind: "trending", moreUrl: "https://thangs.com/browse/trending", rank: 3 },
  },
  examples: {
    model: "https://thangs.com/designer/username/3d-model/Example%20Model-1234567",
    list: "https://thangs.com/designer/username/collection/Example%20Collection-123456",
    browse: "https://thangs.com/designer/…/collection/…",
  },
  errorCodes: { session: "thangs_session", downloadLimit: "THANGS_DOWNLOAD_LIMIT" },
  legacy: { lists: [{ path: "thangs-list", idsField: "model_ids" }] },
  extension: { site: "optional", origins: ["*://thangs.com/*", "*://*.thangs.com/*"] },
} as const satisfies ProviderManifest;
