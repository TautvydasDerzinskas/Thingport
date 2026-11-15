import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "no sign-in to import; yours adds your own collections and likes.",
  about:
    "QIDI Maker is the model community of QIDI Tech, the Chinese maker of the X-Plus, X-Max and Q printers. It opened in 2026, and its models come with print profiles made in QIDI Studio for those printers.",
  description:
    "Import models from QIDI Maker with their QIDI Studio print profiles, anyone's public collections, and your own collections and likes with your sign-in.",
  signIn: "Yours, for your collections and likes",
  highlight: {
    title: "QIDI Studio profiles, for any printer",
    text: "Each print profile is a QIDI Studio project and comes in as a plate of its own. On the model's page, Thingport Grab's Download adapted makes a copy of the picked profile for your slicer and printer.",
    link: "features/adapted-3mf#without-thingport",
  },
} satisfies ProviderDocs;
