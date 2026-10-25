// GENERATED from providers/printables/manifest.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
import type { ProviderManifest } from "../_lib/types.generated";

export default {
  id: "printables",
  name: "Printables",
  order: 2,
  site: "https://www.printables.com",
  docsSlug: "printables",
  hosts: ["printables.com"],
  credentialHosts: { "printables-api": { exact: ["api.printables.com"] } },
  endpoints: { graphql: "https://api.printables.com/graphql/", media: "https://media.printables.com/" },
  brand: {
    logo: { color: "#FA6831", path: "M3.678 4.8 12 9.6v9.6l8.322-4.8V4.8L12 0ZM12 19.2l-8.322-4.8V24Z" },
    accent: "#FA6831",
  },
  signIn: "none",
  sessionCookies: { token: "auth.access_token" },
  auth: [],
  modelNoun: "models",
  helpers: { grab: "optional", flaresolverr: "recommended" },
  solverRoutes: [{ host: "www.printables.com", path: /^(?:\/[a-z]{2})?\/model\/\d+(?:-[\w%-]+)?\/?$/, query: [] }],
  slicers: ["prusaslicer"],
  capabilities: {
    collections: true,
    likes: true,
    profiles: false,
    paidModels: false,
    ownLists: "username",
    categoryIds: "number",
    trending: { kind: "trending", moreUrl: "https://www.printables.com/model?ordering=trending", rank: 1 },
  },
  examples: {
    model: "https://www.printables.com/model/123456-example-model",
    list: "https://www.printables.com/@username/collections/12345-example-collection",
    browse: "https://www.printables.com/@…/collections/…",
  },
  errorCodes: {},
  legacy: { lists: [{ path: "printables-collection", kinds: ["collection"], idsField: "model_ids" }] },
  extension: { site: "builtin", origins: ["*://*.printables.com/*"], cookies: true },
} as const satisfies ProviderManifest;
