import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "no sign-in at all; its CAD projects need Thingport Grab.",
  about:
    "A parametric CAD app that runs in the browser, with a gallery of two halves: a library of CC0 and CC-BY parts to build from, and the projects its users share. Those are CAD, not meshes, so its editor builds the files.",
  description:
    "Import OwlCAD's library parts and community CAD models. Nothing needs a sign-in, though a CAD project's file " +
    "is built by OwlCAD's own editor, so it comes through Thingport Grab.",
  signIn: "None",
  note: {
    text: "A gallery item that is a CAD project, rather than a library part, has no stored mesh: OwlCAD's editor builds its file, so Thingport Grab exports it on owlcad.com.",
    on: ["grab"],
  },
  highlight: {
    title: "CAD projects import only through Grab",
    text: "A shared CAD project has no file until OwlCAD's editor builds one, so Thingport Grab exports it on owlcad.com. One pasted into Thingport waits for your next visit there with Grab.",
    link: "grab",
  },
} satisfies ProviderDocs;
