// Its favicon's mark: the angular "M" of Makerables, whose last stroke lifts away in the site's blue. The M itself is
// one colour, so it takes the text colour and stays legible on a dark background; only the lifted stroke is blue.
import type { ProviderManifest } from "../_lib/types";

export default {
  id: "makerables",
  name: "Makerables",
  order: 15,
  site: "https://www.makerables.com",
  docsSlug: "makerables",
  hosts: ["makerables.com"],
  credentialHosts: {
    "makerables-api": { exact: ["www.makerables.com"] },
    "makerables-session": { exact: ["www.makerables.com"] },
  },
  endpoints: { api: "https://www.makerables.com/api", files: "https://cdn.makerables.com" },
  brand: {
    logo: {
      viewBox: "5 4.8 22 22",
      color: "currentColor",
      path:
        "M15.7555 15.4396L10.4847 7.97678H5L15.97 23.5645L20.9705 16.4875C20.7749 16.5999 20.6808 16.6381 20.5263 " +
        "16.7014C18.8141 17.4034 16.7538 16.8558 15.7555 15.4396Z M5.56665 23.5645H10.2345V16.2932L5.56665 " +
        "9.67887V23.5645Z M21.7708 16.2633V23.5645H25.3217C25.9379 23.5645 26.4053 23.0619 26.4053 22.4596L26.4124 " +
        "9.66394",
      layers: [
        {
          d:
            "M16.4076 15.1961C16.3862 15.2928 16.7558 15.6059 16.8521 15.6822C18.624 17.0875 20.9137 16.4815 " +
            "22.1515 14.8428C23.8275 12.6241 27 7.97716 27 7.97716H21.4708",
          color: "#007BFF",
        },
      ],
    },
    accent: "#007BFF",
  },
  // Its projects, their files and its listings are anyone's to read; only the user's own saved projects need a sign-in.
  signIn: "userOptional",
  // Auth0's Next.js SDK keeps the sign-in in a `__session` cookie, split into `__session__0`, `__session__1`, … once
  // it outgrows one cookie, so `session` is the prefix to look for rather than a whole name.
  sessionCookies: { session: "__session" },
  auth: [{ slot: "default", scope: "user", fields: [{ name: "session", multiline: true }] }],
  modelNoun: "models",
  helpers: { grab: "recommended", flaresolverr: "none" },
  capabilities: {
    collections: true,
    // It counts likes, but has no page or call that lists them: only the saved projects can be read back.
    likes: false,
    profiles: false,
    paidModels: false,
    ownLists: "signIn",
    categoryIds: "number",
    trending: { kind: "popular", moreUrl: "https://www.makerables.com/projects?sort=popular", rank: 14 },
  },
  examples: {
    model: "https://www.makerables.com/project/acrylic-knife",
    list: "https://www.makerables.com/user/G1234567890?tab=saved",
    browse: "https://www.makerables.com/user/…?tab=saved",
  },
  errorCodes: { session: "makerables_session" },
  extension: { site: "optional", origins: ["*://makerables.com/*", "*://*.makerables.com/*"] },
} as const satisfies ProviderManifest;
