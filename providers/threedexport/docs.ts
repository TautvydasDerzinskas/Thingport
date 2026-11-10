import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "your own sign-in, for the files and your own collections; anyone's public collections read without it.",
  about:
    "One of the oldest 3D model marketplaces, open since 2004 and based in San Jose: game and film assets, textures and a large 3D printing catalogue, sold by their designers and some given away free.",
  description:
    "Import 3DExport's free 3D print models and the ones you bought, and your own or anyone's public collections, with your own sign-in.",
  signIn: "Yours, for the files",
  collections: "Bookmark collections",
  highlight: {
    title: "Only the formats Thingport opens",
    text: "3DExport packs each format into a zip of its own, often a dozen for one CG model. Thingport fetches the ones a slicer or LightBurn opens (STL, 3MF, STEP, LightBurn) first, an OBJ or GLB only when those bring no model.",
  },
} satisfies ProviderDocs;
