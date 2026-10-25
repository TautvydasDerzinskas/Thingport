// Its roundel (Manyfold's), drawn flat: the purple disc, the cyan hexagon and the magenta star within it, without its
// glow and gradients, which a logo here can't have.
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
      color: "#553D8F",
      path: "M0 12a12 12 0 1 0 24 0a12 12 0 1 0 -24 0Z",
      layers: [
        { d: "M12 3.6L19.275 7.8L19.275 16.2L12 20.4L4.725 16.2L4.725 7.8Z", color: "#C321E0" },
        { d: "M9.1 12a2.9 2.9 0 1 0 5.8 0a2.9 2.9 0 1 0 -5.8 0Z", color: "#1F0B26" },
        {
          d: "M12 3.6L19.275 16.2L4.725 16.2ZM5.418 15.8L18.582 15.8L12 4.4ZM12 20.4L4.725 7.8L19.275 7.8ZM18.582 8.2L5.418 8.2L12 19.6Z",
          color: "#EFA3FA",
        },
        {
          d: "M12 2.4L20.314 7.2L20.314 16.8L12 21.6L3.686 16.8L3.686 7.2ZM4.725 7.8L4.725 16.2L12 20.4L19.275 16.2L19.275 7.8L12 3.6Z",
          color: "#6DF4FC",
        },
      ],
    },
    accent: "#C321E0",
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
