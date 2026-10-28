import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "no sign-in at all; its CAD projects need Thingport Grab.",
  description:
    "Import OwlCAD's library parts and community CAD models. Nothing needs a sign-in, though a CAD project's file " +
    "is built by OwlCAD's own editor, so it comes through Thingport Grab.",
  signIn: "None",
  note: {
    text: "A gallery item that is a CAD project, rather than a library part, has no stored mesh: OwlCAD's editor builds its file, so Thingport Grab exports it on owlcad.com.",
    on: ["grab"],
  },
} satisfies ProviderDocs;
