// GENERATED from providers/pixup3d/manifest.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
// Its logo's mark, without the wordmark: the folded "P" of two white faces (here the text colour, so it reads on
// either theme) and three in its red.
import type { ProviderManifest } from "../_lib/types.generated";

export default {
  id: "pixup3d",
  name: "PIXUP",
  order: 19,
  site: "https://pixup3d.com",
  docsSlug: "pixup3d",
  hosts: ["pixup3d.com"],
  credentialHosts: { "pixup3d-session": { exact: ["pixup3d.com"] } },
  // What its pages call, and where its pictures are.
  endpoints: { api: "https://pixup3d.com/api/v1", files: "https://file.pixup3d.com" },
  brand: {
    logo: {
      viewBox: "-3.4 0 31 31",
      color: "currentColor",
      path:
        "M21.3875 3.7891L16.243 0.8845C14.2052 -0.2949 11.6924 -0.2949 9.6546 0.8845L0 6.4804L6.0446 9.9841L15.793 " +
        "4.3381C15.793 4.3381 16.2461 4.0683 16.6806 3.8111C17.1244 3.5476 17.6432 3.4284 17.9745 3.3814C19.9842 " +
        "3.1022 21.3875 3.7891 21.3875 3.7891Z M6.0449 23.9959V31.0001L18.1373 23.9959L12.0927 20.4922L6.0449 23.9959Z",
      layers: [
        {
          d:
            "M17.9749 3.3778C18.1374 3.8326 18.1374 5.1657 18.1374 5.1657C18.1374 8.1456 16.5528 10.8965 13.9837 " +
            "12.3864L12.0928 13.4811L18.1374 16.9848L19.8377 15.9999C22.5256 14.4409 24.1821 11.5614 24.1821 " +
            "8.4467C24.1821 8.4467 24.2102 5.5547 21.7911 4.0083C20.1533 2.9669 17.9749 3.3778 17.9749 3.3778Z " +
            "M0 27.4954L6.0446 30.9991V9.9832L0 6.4795V27.4954Z M12.0928 20.4918L18.1374 23.9955V16.9881L12.0928 " +
            "13.4844V20.4918Z",
          color: "#DC4B2D",
        },
      ],
    },
    accent: "#DC4B2D",
  },
  // Its models and anyone's wishlist or collections are anyone's to read; their files go only to a signed-in user who
  // owns them, a free model through a $0 order.
  signIn: "user",
  // Rails' cookie-stored session is the whole sign-in: no remember-me cookie beside it. A visitor gets one too.
  sessionCookies: { session: "_phrozen_session" },
  auth: [{ slot: "default", scope: "user", fields: [{ name: "session", multiline: true }] }],
  modelNoun: "models",
  helpers: { grab: "recommended", flaresolverr: "none" },
  capabilities: {
    // A creator's collections, which it calls Series on their profile.
    collections: true,
    // Its wishlists, anyone's to read.
    likes: true,
    profiles: false,
    paidModels: true,
    ownLists: "signIn",
    categoryIds: "number",
    // Its home page's Trending link: the most viewed models of the week.
    trending: { kind: "trending", moreUrl: "https://pixup3d.com/en/posts?o=most_views_w", rank: 18 },
  },
  examples: {
    model: "https://pixup3d.com/en/posts/427",
    list: "https://pixup3d.com/en/p/Atlanticus/collections/5",
    browse: "https://pixup3d.com/en/p/…/saved_posts",
  },
  errorCodes: { session: "pixup3d_session" },
  extension: { site: "optional", origins: ["*://pixup3d.com/*", "*://*.pixup3d.com/*"] },
} as const satisfies ProviderManifest;
