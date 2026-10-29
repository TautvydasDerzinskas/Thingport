// Its favicon's mark: a cube seen from one corner, open on the right like a C, in the site's teals. The lit faces are
// the base path; the darker bottom face and the two sides, which the site shades with gradients, are layers of a
// flat teal each.
import type { ProviderManifest } from "../_lib/types";

export default {
  id: "cgtrader",
  name: "CGTrader",
  order: 16,
  site: "https://www.cgtrader.com",
  docsSlug: "cgtrader",
  hosts: ["cgtrader.com"],
  endpoints: { files: "https://secure-files.cgtrader.com" },
  brand: {
    logo: {
      viewBox: "0 0 40 40",
      color: "#19BCC9",
      path:
        "M19.1494 39.5174c.2635.1495.557.2243.8505.2243v-6.5502l-11.99996-6.8085-5.76752 3.2723c.14914.2546.36475" +
        ".4708.63128.622z M7.99994 13.617l16.95806-9.62163c.4607-.26138.4607-.92091 0-1.18229l-4.1085-2.331086c-.5268" +
        "-.298479-1.1734-.298298-1.7001.000543l-16.2857 9.240123c-.26653.15122-.48214.36744-.63128.62194z M37.7674 " +
        "10.3446c-.1488-.254-.3638-.46981-.6296-.62098l-4.2883-2.43312-.0047-.00263c-.526-.29585-1.1702-.29479-1.6954" +
        ".00317l-16.1076 9.13906c-.4607.2614-.4607.9209 0 1.1823l4.124 2.3399c.5193.2871 1.1515.2867 1.6704-.0013z",
      layers: [
        {
          d: "M37.1362 30.2773c.2666-.1512.4822-.3674.6313-.622l-5.7675-3.2723-12 6.8085v6.5502c.2935 0 .587-.0748.8505-.2243z",
          color: "#04ABB8",
        },
        {
          d:
            "M2.23248 29.6554c-.14974-.2556-.23248-.5499-.23248-.8559v-17.5989c0-.306.08274-.6003.23248-.8559l5.76752 " +
            "3.2724v12.7659z M37.7675 10.3447l-5.7675 3.2724v12.7659l5.7675 3.2724c.1498-.2556.2325-.5499.2325-.8559v" +
            "-17.5989c0-.306-.0827-.6003-.2325-.8559z",
          color: "#0E9EAA",
        },
      ],
    },
    accent: "#19BCC9",
  },
  // Its model pages and listings are anyone's to read; its files, free ones included, go only to a signed-in user.
  signIn: "user",
  // Rails' session cookie is the sign-in. AWS's bot check (its WAF) wants its own token beside it for the downloads,
  // which the browser gets by passing the check. A visitor gets a session cookie too, and only a signed-in browser has
  // `user_id`, which is how Grab tells the two apart; the backend never sends it.
  sessionCookies: { session: "_cgtrader_session_id", waf: "aws-waf-token", user: "user_id" },
  auth: [{ slot: "default", scope: "user", fields: [{ name: "session", multiline: true }] }],
  modelNoun: "models",
  // Either one gets the downloads past the bot check: Grab with the browser's token, FlareSolverr with one of its own.
  helpers: { grab: "recommended", flaresolverr: "recommended" },
  capabilities: {
    // The wishlist, the user's own like the likes.
    collections: true,
    likes: true,
    profiles: false,
    paidModels: true,
    ownLists: "signIn",
    // A category is the `<category>/<subcategory>` its model's address names; the site has no ids for them.
    categoryIds: "path",
    trending: { kind: "trending", moreUrl: "https://www.cgtrader.com/3d-print-models?sort_by=trending", rank: 15 },
  },
  examples: {
    model: "https://www.cgtrader.com/3d-print-models/jewelry/ring/lotus-ring-with-opening-and-closing-mechanism",
    list: "https://www.cgtrader.com/profile/liked_models",
    browse: "https://www.cgtrader.com/profile/liked_models",
  },
  errorCodes: { session: "cgtrader_session", downloadLimit: "CGTRADER_DOWNLOAD_LIMIT" },
  extension: { site: "optional", origins: ["*://cgtrader.com/*", "*://*.cgtrader.com/*"] },
} as const satisfies ProviderManifest;
