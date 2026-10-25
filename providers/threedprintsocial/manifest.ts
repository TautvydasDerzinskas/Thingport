// Not its own logo, which Thingport hasn't a copy of: an isometric cube, its three faces apart, in the Fediverse's
// violet, as the site is a Manyfold server on the Fediverse.
import type { ProviderManifest } from "../_lib/types";

export default {
  // Ids are identifiers in the generated code, so it can't start with the site's "3".
  id: "threedprintsocial",
  name: "3DPrint.social",
  order: 13,
  site: "https://3dprint.social",
  docsSlug: "3dprint-social",
  hosts: ["3dprint.social"],
  brand: {
    logo: {
      color: "#6364FF",
      path: "M12 1.6l8.6 4.95L12 11.5 3.4 6.55zM2.6 7.95l8.6 4.95v9.5l-8.6-4.95zM21.4 7.95v9.5l-8.6 4.95v-9.5z",
    },
    accent: "#6364FF",
  },
  signIn: "none",
  auth: [],
  modelNoun: "models",
  helpers: { grab: "optional", flaresolverr: "none" },
  capabilities: {
    collections: true,
    // Its likes are each user's own private list, which it shows to no one else.
    likes: false,
    profiles: false,
    paidModels: false,
    // The creator the user publishes as: their collections, and their models as a list of its own.
    ownLists: "username",
    // Its models have tags, but no categories.
    categoryIds: "none",
    // It sorts by name, date added and date updated, so it has nothing popular or trending to show.
    trending: false,
  },
  examples: {
    model: "https://3dprint.social/models/xc68zh951g26",
    list: "https://3dprint.social/collections/krfflpzgbtvf",
    browse: "https://3dprint.social/collections?creator=…",
  },
  errorCodes: {},
  extension: { site: "optional", origins: ["*://3dprint.social/*", "*://www.3dprint.social/*"] },
} as const satisfies ProviderManifest;
