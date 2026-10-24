import type { ProviderManifest } from "../_lib/types";

export default {
  id: "printables",
  name: "Printables",
  order: 2,
  site: "https://www.printables.com",
  docsSlug: "printables",
  hosts: ["printables.com"],
  brand: {
    logo: { color: "#FA6831", path: "M3.678 4.8 12 9.6v9.6l8.322-4.8V4.8L12 0ZM12 19.2l-8.322-4.8V24Z" },
    chip: { bg: "#FA6831" },
  },
  signIn: "none",
  helpers: { grab: "optional", flaresolverr: "recommended" },
  capabilities: {
    collections: true,
    likes: true,
    profiles: false,
    paidModels: false,
    categoryIds: "int",
    trending: { kind: "trending", moreUrl: "https://www.printables.com/model?ordering=trending", rank: 1 },
  },
  errorCodes: {},
  extension: { site: "builtin", origins: ["*://*.printables.com/*"] },
} as const satisfies ProviderManifest;
