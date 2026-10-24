// Its own fill is an angular gradient; this is the gradient's lighter end.
import type { ProviderManifest } from "../_lib/types";

export default {
  id: "nexprint",
  name: "NexPrint",
  order: 8,
  site: "https://www.nexprint.com",
  docsSlug: "nexprint",
  hosts: ["nexprint.com"],
  brand: {
    logo: {
      viewBox: "0 -0.97 30 30",
      color: "#7A55E3",
      path: "M15 18.5519L19.1113 12.0919H25.6592C26.2106 12.0921 26.7007 12.4444 26.877 12.9669L29.9307 22.0236C30.2114 22.8566 29.592 23.7198 28.7129 23.7198H1.28613C0.407131 23.7196 -0.212382 22.8566 0.0683594 22.0236L3.12305 12.9669C3.29939 12.4443 3.78924 12.0919 4.34082 12.0919H10.8877L7.21191 6.31555C6.66766 5.45993 7.2819 4.34031 8.2959 4.33997H21.7002C22.7143 4.34001 23.3292 5.45985 22.7852 6.31555L19.1094 12.0919H10.8887L15 18.5519Z",
    },
    chip: { bg: "#7A55E3" },
    accent: "#7A55E3",
  },
  signIn: "user",
  sessionCookies: { token: "auth_token" },
  auth: [
    {
      slot: "default",
      scope: "user",
      fields: [{ name: "token" }],
      legacyEndpoint: { path: "nexprint-session", method: "PATCH" },
    },
  ],
  modelNoun: "models",
  helpers: { grab: "recommended", flaresolverr: "none" },
  slicers: ["elegooslicer"],
  capabilities: {
    collections: true,
    likes: false,
    profiles: true,
    paidModels: false,
    ownLists: "signIn",
    categoryIds: "text",
    trending: { kind: "recommended", moreUrl: "https://www.nexprint.com/", rank: 9 },
  },
  examples: {
    model: "https://www.nexprint.com/en/models/G1234567",
    list: "https://www.nexprint.com/en/collection/G12345678",
    browse: "https://www.nexprint.com/en/…/home?component=UserCollect&subComp=UserCollectDetail&collectionId=G…",
  },
  errorCodes: { session: "nexprint_session" },
  legacy: { lists: [{ path: "nexprint-collection", idsField: "model_ids" }], profiles: "nexprint-profiles" },
  extension: { site: "optional", origins: ["*://*.nexprint.com/*"] },
} as const satisfies ProviderManifest;
