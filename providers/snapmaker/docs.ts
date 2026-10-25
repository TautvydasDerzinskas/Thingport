import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "your own sign-in, which only Thingport Grab keeps alive.",
  description:
    "Import Snapmaker Space models, likes and bookmarks with your sign-in, which Thingport Grab keeps alive.",
  signIn: "Yours, for a day",
  collections: "Bookmarks",
  note: {
    text: "Snapmaker's sign-in lasts a day and only Grab renews it; without Grab you paste a new one every day.",
    on: ["grab"],
  },
} satisfies ProviderDocs;
