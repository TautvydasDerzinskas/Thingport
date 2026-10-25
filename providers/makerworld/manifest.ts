// MakerWorld has no glyph of its own in Simple Icons, so it takes Bambu Lab's, whose site it is.
import type { ProviderManifest } from "../_lib/types";

export default {
  id: "makerworld",
  name: "MakerWorld",
  order: 1,
  site: "https://makerworld.com",
  docsSlug: "makerworld",
  hosts: ["makerworld.com"],
  credentialHosts: {
    "makerworld-page": { exact: ["makerworld.com", "www.makerworld.com"] },
    "makerworld-extension": { exact: ["makerworld.com"] },
    "makerworld-cloud": { exact: ["api.bambulab.com"] },
  },
  endpoints: { api: "https://makerworld.com/api/v1", cloudApi: "https://api.bambulab.com/v1" },
  brand: {
    logo: {
      color: "#00AE42",
      path: "M12.662 24V8.959l8.535 3.369V24zm-9.859-.003v-7.521l8.534-3.371-.001 10.892zM2.803 0h8.533l.001 11.672-8.534 3.369zm9.859 0h8.535v10.892l-8.535-3.371z",
    },
    accent: "#00AE42",
  },
  signIn: "user",
  sessionCookies: { token: "token" },
  auth: [
    {
      slot: "default",
      scope: "user",
      fields: [{ name: "cookie", multiline: true }],
      legacyEndpoint: { path: "makerworld", method: "PATCH" },
    },
  ],
  modelNoun: "models",
  helpers: { grab: "recommended", flaresolverr: "optional" },
  solverRoutes: [
    {
      host: "makerworld.com",
      path: /^(?:\/[a-z]{2}\/models\/\d+(?:-[\w%-]+)?\/?|\/api\/v1\/models?\/\d+(?:\/files|\/download)?|\/api\/v1\/design-service\/instance\/\d+\/f3mf|\/api\/v1\/design-service\/favorites\/\d+(?:\/designs)?|\/api\/v1\/design-user-service\/user\/profile\/[\w%-]+)$/,
      query: ["type", "fileType", "seed", "collectionId", "limit", "offset"],
      credentials: { cookies: true },
    },
  ],
  slicers: ["bambustudio", "orcaslicer"],
  capabilities: {
    collections: true,
    likes: false,
    profiles: true,
    paidModels: false,
    ownLists: "signIn",
    categoryIds: "number",
    trending: { kind: "trending", moreUrl: "https://makerworld.com/en", rank: 2 },
    listImport: "grab",
    syncsNewOnly: true,
    rawFilesZip: true,
    bambuProjects: true,
  },
  examples: {
    model: "https://makerworld.com/en/models/123456-example-model",
    list: "https://makerworld.com/en/collections/12345-example-collection",
    browse: "https://makerworld.com/en/collections/…",
  },
  errorCodes: { session: "MAKERWORLD_AUTH", downloadLimit: "MAKERWORLD_DOWNLOAD_LIMIT" },
  legacy: { lists: [{ path: "collection", idsField: "design_ids" }], profiles: "makerworld-profiles" },
  extension: { site: "builtin", origins: ["*://*.makerworld.com/*"], cookies: true },
} as const satisfies ProviderManifest;
