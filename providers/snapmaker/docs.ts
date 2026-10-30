import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "your own sign-in, which only Thingport Grab keeps alive.",
  about:
    "Snapmaker's own model site, built around the U1, its multi-colour toolchanger. The company made its name with modular machines that 3D print, laser-cut and carve from one frame.",
  description:
    "Import Snapmaker Space models, likes and bookmarks with your sign-in, which Thingport Grab keeps alive.",
  signIn: "Yours, for a day",
  collections: "Bookmarks",
  note: {
    text: "Snapmaker's sign-in lasts a day and only Grab renews it; without Grab you paste a new one every day.",
    on: ["grab"],
  },
  highlight: {
    title: "Only Grab keeps your sign-in alive",
    text: "Snapmaker's sign-in lasts a day, and only Thingport Grab renews it, every few hours while your browser is open. Without Grab, you paste a new one every day.",
    link: "grab#snapmaker-space-a-sign-in-grab-keeps-fresh",
  },
} satisfies ProviderDocs;
