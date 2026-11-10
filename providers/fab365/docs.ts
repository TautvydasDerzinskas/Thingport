import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "your own sign-in, for the files and your favourites; its models read without one.",
  about:
    "Fab365 is a South Korean 3D-model marketplace, running since 2018. It's known for meticulously engineered models — SpaceX rockets, foldable robots, Star Wars ships — many designed to print cleanly without supports.",
  description:
    "Import Fab365's free models and the ones you own, and your favourites, with your own sign-in for the files.",
  signIn: "Yours, for the files",
  note: {
    text: "Fab365 hands a model's files to signed-in members only, the free ones included, and shows your favourites to you alone.",
    on: ["likes"],
  },
  highlight: {
    title: "Owned and free models, your files",
    text: "Fab365 sells its models and gives a few free. Thingport imports the free ones and any you own — bought or redeemed with a Fab365 ticket — with your own sign-in for the files; it never spends your money or tickets.",
  },
} satisfies ProviderDocs;
