// Its mark: a cube drawn as an open hexagon, with a face folded out of it, in the indigo of the site's own icon. Its
// pages' buttons are a lighter blue, the accent.
import type { ProviderManifest } from "../_lib/types";

export default {
  id: "qidimaker",
  name: "QIDI Maker",
  order: 22,
  site: "https://www.qidimaker.com",
  docsSlug: "qidimaker",
  hosts: ["qidimaker.com"],
  // Its pages' API on the site's own host, which the sign-in goes to; the files are on a CDN that needs none.
  credentialHosts: { "qidimaker-api": { exact: ["www.qidimaker.com"] } },
  endpoints: { files: "https://public-cdn.qidimaker.com" },
  brand: {
    logo: {
      viewBox: "0 0 26 26",
      color: "#3039B0",
      path:
        "M15.313 20.76V15.3c0-.366.194-.703.513-.885l4.473-2.587 2.048-1.183V7.327a2.05 2.05 0 0 0-1.02-1.776L12.196" +
        ".274a2.05 2.05 0 0 0-2.047 0L1.02 5.551A2.05 2.05 0 0 0 0 7.327v10.554c0 .731.388 1.41 1.021 1.776l9.129 " +
        "5.277a2.05 2.05 0 0 0 2.048 0l3.115-1.799zm-3.12-9.92a2.05 2.05 0 0 0-1.022 1.776v8.766c0 .788-.856 1.28-" +
        "1.535.885l-7.08-4.089a1.02 1.02 0 0 1-.514-.885V7.927c0-.366.194-.703.514-.885l8.101-4.683a1.02 1.02 0 0 1 " +
        "1.022 0l6.059 3.5a1.025 1.025 0 0 1 0 1.777zM23.747 9.841l-1.392.805v7.847c0 .36-.194.692-.514.863l-.108" +
        ".063-.148.085-1.284.743-.827.48-4.154 2.398v1.582c.017.76.822 1.245 1.5.902l.035-.017.822-.474 7.091-4.117" +
        "c.314-.183.508-.52.508-.886v-9.383a1.02 1.02 0 0 0-1.53-.89",
    },
    accent: "#4479FB",
  },
  // Its models, their print profiles and files, its listings and anyone's public collections are anyone's to read;
  // the user's own collections and likes need their sign-in.
  signIn: "userOptional",
  // The site's sign-in is this one cookie, kept for 90 days.
  sessionCookies: { token: "token" },
  auth: [{ slot: "default", scope: "user", fields: [{ name: "token", multiline: true }] }],
  modelNoun: "models",
  helpers: { grab: "recommended", flaresolverr: "none" },
  slicers: ["qidistudio"],
  capabilities: {
    collections: true,
    likes: true,
    profiles: true,
    paidModels: false,
    ownLists: "signIn",
    // Numbers too big for a JavaScript number, so they're kept as the text they are.
    categoryIds: "number",
    trending: { kind: "trending", moreUrl: "https://www.qidimaker.com/en/models", rank: 21 },
    // QIDI Studio projects: the site takes no other kind of 3MF for a print profile.
    adapted3mfs: ["bambu"],
  },
  examples: {
    model: "https://www.qidimaker.com/en/models/detail/2077275848848752642",
    list: "https://www.qidimaker.com/en/collections/detail/2119450902810669058",
    browse: "https://www.qidimaker.com/en/my/collections",
  },
  errorCodes: { session: "qidimaker_session" },
  extension: { site: "optional", origins: ["*://www.qidimaker.com/*"] },
} as const satisfies ProviderManifest;
