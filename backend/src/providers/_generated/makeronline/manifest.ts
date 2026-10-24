// GENERATED from providers/makeronline/manifest.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
// Its mark is black and white, the two diamonds of its logo, so the mark and the chip follow the theme.
import type { ProviderManifest } from "../_lib/types";

export default {
  id: "makeronline",
  name: "MakerOnline",
  order: 6,
  site: "https://www.makeronline.com",
  docsSlug: "makeronline",
  hosts: ["makeronline.com"],
  brand: {
    logo: {
      viewBox: "0.15 -10.2 50 50",
      color: "currentColor",
      path: "M13.036 4.95V.25l11.99 11.988v4.701L13.035 4.951Zm11.99 12.296L12.917 5.14.812 17.246l12.106 12.106 12.107-12.106Zm24.452 0L37.371 5.14 25.265 17.246 37.37 29.352l12.107-12.106ZM12.807.25.817 12.238v4.701l11.99-11.988V.25Zm24.674 4.7V.25l11.99 11.988v4.701L37.48 4.951Zm-.23-4.7L25.263 12.238v4.701l11.99-11.988V.25Z",
      fillRule: "evenodd",
    },
    chip: { bg: "text", fg: "inverse" },
  },
  signIn: "userOptional",
  auth: [
    {
      slot: "default",
      scope: "user",
      fields: [{ name: "token" }],
      legacyEndpoint: { path: "makeronline-session", method: "PATCH" },
    },
  ],
  helpers: { grab: "required", flaresolverr: "none" },
  capabilities: {
    collections: true,
    likes: true,
    profiles: true,
    paidModels: false,
    categoryIds: "int",
    trending: { kind: "trending", moreUrl: "https://www.makeronline.com/", rank: 4 },
  },
  errorCodes: { needsGrab: "makeronline_grab" },
  legacy: { lists: [{ path: "makeronline-list", idsField: "model_ids" }] },
  extension: { site: "optional", origins: ["*://*.makeronline.com/*"] },
} as const satisfies ProviderManifest;
