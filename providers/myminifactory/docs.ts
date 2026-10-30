import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "one API key, set by an admin; your own sign-in for paid models.",
  about:
    "London's iMakr started it in 2013 on a promise: every file test-printed before it went up. It leans heavily on tabletop miniatures, and runs Scan the World, a free archive of scanned sculptures and museum pieces.",
  description:
    "Import free MyMiniFactory models with an admin's API key, and the ones you bought with your own sign-in.",
  signIn: "Admin's API key, yours for paid",
  highlight: {
    title: "Models you bought need your own sign-in",
    text: "An admin's API key covers free models for everyone. Bought ones, and free ones that download only when signed in, need your account: open MyMiniFactory signed in, with Thingport Grab allowed there.",
    link: "grab#myminifactory-and-newer-sites-allow-them-once",
  },
} satisfies ProviderDocs;
