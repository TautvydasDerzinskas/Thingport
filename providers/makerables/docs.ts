import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "no sign-in to import; yours adds your saved projects.",
  about:
    "Makera's project site, where desktop CNC meets 3D printing. Makera makes the Carvera mills, and every project here is free and carries its CAM files and machining programs beside the models they cut.",
  description:
    "Import the model files of Makerables' CNC and 3D printing projects, and the ones you saved with your own sign-in.",
  signIn: "Yours, for saved projects only",
  collections: "Saved",
  highlight: {
    title: "Only a project's model files are imported",
    text: "You get the STEP and STL files on a project's Model Files tab; its NC and CAM files stay on Makerables. A project with only pictures or native CAD files there has nothing to import.",
  },
} satisfies ProviderDocs;
