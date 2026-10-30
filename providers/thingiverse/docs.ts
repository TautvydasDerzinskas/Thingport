import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "one App Token, set by an admin.",
  about:
    "The original: MakerBot put it up in 2008, and millions of designs later it is still where much of 3D printing's common stock lives, most of it openly licensed. It belongs to UltiMaker now, after MakerBot's merger.",
  description: "Import Thingiverse things, collections and likes with an App Token an admin sets once.",
  signIn: "Admin's App Token",
  highlight: {
    title: "An admin sets one App Token for everyone",
    text: "Thingiverse is connected for every user once an admin saves its App Token, so there's nothing for you to connect. If it shows as not connected, ask your admin to set one up.",
    link: "providers#connecting-a-provider",
  },
} satisfies ProviderDocs;
