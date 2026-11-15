import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "no sign-in to import; yours adds your own collections and likes.",
  about:
    "VoxelShare is the model community of Flashforge, the Chinese maker of the Adventurer and Creator printers. Its models come with print profiles for those printers, made in Flash Studio, Flashforge's own slicer.",
  description:
    "Import models from VoxelShare and its China site with their print profiles for Flashforge printers, anyone's public collections, and your own collections and likes with your sign-in.",
  signIn: "Yours, for your collections and likes",
  highlight: {
    title: "Flashforge profiles, for any printer",
    text: "Each print profile, a project for a Flashforge printer, comes in as a plate of its own. On the model's page, Thingport Grab's Download adapted makes a copy of the picked profile for your slicer and printer.",
    link: "features/adapted-3mf#without-thingport",
  },
} satisfies ProviderDocs;
