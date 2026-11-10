// Its logo's mark without the wordmark: a hexagon folded into an "E", which the site draws as a line ten units wide in
// a red gradient. Here it's that line's outline, in the gradient's middle red.
import type { ProviderManifest } from "../_lib/types";

export default {
  // Not "3dexport": ids name variables in the generated code, which can't start with a digit.
  id: "threedexport",
  name: "3DExport",
  order: 21,
  site: "https://3dexport.com",
  docsSlug: "3dexport",
  hosts: ["3dexport.com"],
  credentialHosts: { "threedexport-session": { exact: ["3dexport.com"] } },
  // Where a download link sends a signed-in user: a signed S3 link to one format's zip.
  endpoints: { files: "https://netrinofiles.s3.amazonaws.com" },
  brand: {
    logo: {
      viewBox: "-6.1 -1 119 119",
      color: "#EE1111",
      fillRule: "evenodd",
      path:
        "M51.52 -0.79 0 29.02 0 87.98 51.52 117.79 106.68 85.33 74.93 65.44 51.57 77.63 39.43 70.92 60 58.61 38.76 " +
        "45.22 51.55 37.59 74.81 50.89 106.79 31.71z M51.48 10.79 10 34.78 10 82.22 51.48 106.21 87.42 85.07 74.47 " +
        "76.96 51.43 88.97 19.37 71.28 40.9 58.39 19.64 44.98 51.45 26.01 74.69 39.31 87.21 31.79z",
    },
    accent: "#EE1111",
  },
  // Its models, listings and public collections are anyone's to read; its files, the free ones' too, go only to a
  // signed-in user.
  signIn: "user",
  // Its remember-me pair is the sign-in: the user's number and a hash, kept ten years and turned into a fresh session
  // by any request that sends them. A visitor gets `nm_userid=-1` and no hash. Signing out anywhere revokes the hash.
  sessionCookies: { user: "nm_userid", hash: "nm_hash" },
  auth: [{ slot: "default", scope: "user", fields: [{ name: "session", multiline: true }] }],
  modelNoun: "models",
  helpers: { grab: "recommended", flaresolverr: "none" },
  capabilities: {
    // Its bookmarks, which it keeps as collections: the user's own, private ones too, and anyone's public ones.
    collections: true,
    likes: false,
    profiles: false,
    paidModels: true,
    ownLists: "signIn",
    // A category is the path its breadcrumb names under 3D Print Models; the site has no ids for them.
    categoryIds: "path",
    // Its Best Sales order of 3D print models.
    trending: { kind: "popular", moreUrl: "https://3dexport.com/3d-print-models?order_by=bestsales", rank: 20 },
  },
  examples: {
    model: "https://3dexport.com/3d-model-elephant-a001-667112",
    list: "https://3dexport.com/bookmarks/3d-collection-6956",
    browse: "https://3dexport.com/mybookmarks",
  },
  errorCodes: { session: "threedexport_session" },
  extension: { site: "optional", origins: ["*://3dexport.com/*", "*://*.3dexport.com/*"] },
} as const satisfies ProviderManifest;
