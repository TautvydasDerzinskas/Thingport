import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "your own sign-in, for the files, your likes and your wishlist; Grab or FlareSolverr for its bot check.",
  about:
    "A Vilnius-born marketplace of over three million 3D models, started in 2011: game and film assets, renders and a large 3D printing catalogue, sold by their designers and many of them free.",
  description:
    "Import CGTrader's 3D print models, free or bought, and the ones you liked or wishlisted, with your own sign-in.",
  signIn: "Yours, for the files",
  collections: "Wishlist",
  note: {
    text: "CGTrader shows your likes and wishlist to you alone, and its downloads sit behind AWS's bot check, which Thingport passes with Grab's token from your browser or FlareSolverr's own.",
    on: ["grab", "likes"],
  },
} satisfies ProviderDocs;
