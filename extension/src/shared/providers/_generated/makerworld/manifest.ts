// GENERATED from providers/makerworld/manifest.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
// MakerWorld has no glyph of its own in Simple Icons, so it takes Bambu Lab's, whose site it is.
import type { ProviderManifest } from "../_lib/types";

export default {
  id: "makerworld",
  name: "MakerWorld",
  order: 1,
  site: "https://makerworld.com",
  docsSlug: "makerworld",
  hosts: ["makerworld.com"],
  brand: {
    logo: {
      color: "#00AE42",
      path: "M12.662 24V8.959l8.535 3.369V24zm-9.859-.003v-7.521l8.534-3.371-.001 10.892zM2.803 0h8.533l.001 11.672-8.534 3.369zm9.859 0h8.535v10.892l-8.535-3.371z",
    },
    chip: { bg: "#00B800" },
  },
  signIn: "user",
  helpers: { grab: "recommended", flaresolverr: "optional" },
  capabilities: { collections: true, likes: false, profiles: true, paidModels: false },
  extension: { site: "builtin", origins: ["*://*.makerworld.com/*"] },
} as const satisfies ProviderManifest;
