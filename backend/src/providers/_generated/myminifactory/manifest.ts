// GENERATED from providers/myminifactory/manifest.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
// Not in Simple Icons: the glyph is its own favicon, scaled to 24.
// The chip is a darker shade of the logo's #00C4A6, so the white label stays readable.
import type { ProviderManifest } from "../_lib/types";

export default {
  id: "myminifactory",
  name: "MyMiniFactory",
  order: 4,
  site: "https://www.myminifactory.com",
  docsSlug: "myminifactory",
  hosts: ["myminifactory.com"],
  brand: {
    logo: {
      color: "#00C4A6",
      path: "M24 0.241V23.759a0.241 0.241 0 0 1 -0.241 0.241H14.4V19.201h4.801V7.2H14.4V14.4H9.6V7.2H4.799v12.001H9.6v4.799H0.481A0.481 0.481 0 0 1 0 23.519V0.241A0.241 0.241 0 0 1 0.241 0H23.759A0.241 0.241 0 0 1 24 0.241Z",
    },
    chip: { bg: "#00866F" },
  },
  signIn: "adminUser",
  helpers: { grab: "optional", flaresolverr: "recommended" },
  capabilities: {
    collections: true,
    likes: false,
    profiles: false,
    paidModels: true,
    categoryIds: "int",
    trending: { kind: "popular", moreUrl: "https://www.myminifactory.com/search/?sortBy=popularity", rank: 6 },
  },
  errorCodes: { session: "myminifactory_session" },
  extension: { site: "optional", origins: ["*://*.myminifactory.com/*"] },
} as const satisfies ProviderManifest;
