import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "works out of the box.",
  about:
    "Prusa Research's repository, called PrusaPrinters until the 2022 rename. It runs several design contests a month and pays contributors in prusameters, points that turn into vouchers for Prusa's own shop.",
  description:
    "Import Printables models and collections with no setup; your likes and private collections through Thingport Grab.",
  signIn: "None",
  note: {
    text: "Your private Printables collections and your likes are read by Grab, while you're on Printables.",
    on: ["grab", "likes"],
  },
  highlight: {
    title: "Your likes and private collections need Grab",
    text: "Printables shows your likes and private collections to you alone, so Thingport Grab reads them while you're there, signed in. Synced ones get new models after your next visit, not on a schedule.",
    link: "guides/synced-collections#private-printables-collections-and-your-printables-likes",
  },
} satisfies ProviderDocs;
