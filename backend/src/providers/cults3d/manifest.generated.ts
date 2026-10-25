// GENERATED from providers/cults3d/manifest.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
import type { ProviderManifest } from "../_lib/types.generated";

export default {
  id: "cults3d",
  name: "Cults3D",
  order: 10,
  site: "https://cults3d.com",
  docsSlug: "cults3d",
  hosts: ["cults3d.com"],
  credentialHosts: {
    "cults3d-api": { exact: ["cults3d.com"] },
    "cults3d-session": { exact: ["cults3d.com"] },
  },
  endpoints: { downloads: "https://download.cults3d.com" },
  brand: {
    logo: {
      viewBox: "0 0 260 260",
      color: "#822EF5",
      path: "M56.145 84.655c-20.238 13.483-33.613 36.496-33.613 62.586 0 41.448 33.725 75.168 75.167 75.168 12.086 0 23.497-2.879 33.62-7.964l-.021-.011-.13-.068c10.161 5.134 21.63 8.043 33.771 8.043 41.45 0 75.173-33.72 75.173-75.168 0-26.113-13.396-49.149-33.663-62.626-2.059-39.665-34.973-71.3-75.14-71.3-40.106 0-72.977 31.542-75.13 71.118l-.034.222zm17.165-8.664c5.779-26.71 29.585-46.787 58.001-46.787 32.728 0 59.353 26.626 59.353 59.354 0 17.274-7.424 32.845-19.238 43.702l-8.281-4.747-15.918 9.123 25.565 14.658c16.324-10.833 28.196-27.854 32.24-47.693 11.799 10.846 19.203 26.394 19.203 43.642 0 32.695-26.601 59.293-59.297 59.293-28.389 0-52.215-20.051-57.995-46.732l8.458-4.879v-18.245l-25.569 14.694c1.14 20.876 10.864 39.506 25.658 52.447l-.007-.017c-5.621 1.775-11.583 2.731-17.785 2.731-32.696 0-59.292-26.598-59.292-59.293 0-32.696 26.595-59.298 59.292-59.298 6.207 0 12.187.962 17.807 2.734l.037 9.626 15.859 9.063v-29.332c-10-5.084-21.58-7.965-33.661-7.965-8.555 0-16.797 1.443-24.466 4.09l.036-.169z",
    },
    accent: "#822EF5",
  },
  signIn: "user",
  sessionCookies: { session: "_session_id", clearance: "cf_clearance" },
  auth: [
    {
      slot: "default",
      scope: "user",
      fields: [{ name: "nick" }, { name: "api_key", secret: true }],
      legacyEndpoint: { path: "cults3d", method: "PATCH" },
    },
    {
      slot: "browser",
      scope: "user",
      fields: [{ name: "session", multiline: true }],
      legacyEndpoint: { path: "cults3d-session", method: "PATCH", noGet: true },
    },
  ],
  modelNoun: "models",
  helpers: { grab: "recommended", flaresolverr: "none" },
  capabilities: {
    collections: true,
    likes: true,
    profiles: false,
    paidModels: true,
    ownLists: "signIn",
    categoryIds: "number",
    trending: { kind: "popular", moreUrl: "https://cults3d.com/en/creations/popular", rank: 7 },
  },
  examples: {
    model: "https://cults3d.com/en/3d-model/art/example-model",
    list: "https://cults3d.com/en/design-collections/username/example-printlist",
    // Its API shows no one's printlists but the user's own, so someone else's means their likes.
    browse: "https://cults3d.com/en/users/…/likes",
  },
  errorCodes: { session: "cults3d_session" },
  legacy: { lists: [{ path: "cults3d-list", idsField: "model_ids" }] },
  extension: { site: "optional", origins: ["*://cults3d.com/*", "*://*.cults3d.com/*"] },
} as const satisfies ProviderManifest;
