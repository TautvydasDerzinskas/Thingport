// GENERATED from providers/fab365/manifest.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
// Its app icon's mark, without the wordmark: the bold "F" of fab365.net, in the text colour so it reads on either
// theme; the site's bright green is the accent.
import type { ProviderManifest } from "../_lib/types.generated";

export default {
  id: "fab365",
  name: "Fab365",
  order: 20,
  site: "https://fab365.net",
  docsSlug: "fab365",
  hosts: ["fab365.net"],
  credentialHosts: { "fab365-token": { exact: ["fab365.net"] } },
  // What its pages call, and the S3 bucket its signed download links point at (its region varies, so the file-host
  // check below allows either form).
  endpoints: { api: "https://fab365.net/api", files: "https://fab-model-v2.s3.ap-northeast-2.amazonaws.com" },
  brand: {
    logo: {
      color: "currentColor",
      path: "M4 3 H20 V8 H9 V10 H16 V15 H9 V21 H4 Z",
    },
    accent: "#00C300",
  },
  // Its model pages are anyone's to read; files go only to a signed-in member who owns the model, a free one included.
  signIn: "user",
  // The sign-in is a JWT the site keeps in page storage (accessToken) with the refresh token beside it, not a cookie,
  // so Grab reads it from an open tab, as eufyMake's is read.
  auth: [{ slot: "default", scope: "user", fields: [{ name: "token", secret: true, multiline: true }] }],
  modelNoun: "models",
  helpers: { grab: "recommended", flaresolverr: "none" },
  capabilities: {
    collections: false,
    // Its favourites, the user's own page and theirs alone to see.
    likes: true,
    profiles: false,
    paidModels: true,
    ownLists: "signIn",
    categoryIds: "number",
    // Its models ranked by likes, as the offer listing's `popular` sort gives them.
    trending: { kind: "popular", moreUrl: "https://fab365.net/categories", rank: 19 },
  },
  examples: {
    model: "https://fab365.net/items/428",
    list: "https://fab365.net/my/likes",
    browse: "https://fab365.net/my/likes",
  },
  errorCodes: { session: "fab365_session" },
  extension: { site: "optional", origins: ["*://fab365.net/*", "*://*.fab365.net/*"] },
} as const satisfies ProviderManifest;
