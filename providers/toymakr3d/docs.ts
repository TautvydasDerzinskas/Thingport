import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "your own sign-in, for the files and your likes; its models read without one.",
  about:
    "One designer's shop of articulated robot and mecha models — Transformers, Megazords, Gundams and the like, printed in place with joints that already move. Most are free to download, the rest are sold.",
  description:
    "Import Toymakr3D's articulated robot and mecha models, and the ones you liked, with your own sign-in for the files.",
  signIn: "Yours, for the files",
  note: {
    text: "Toymakr3D hands a model's files to signed-in users only, the free ones included, and shows your likes to you alone.",
    on: ["likes"],
  },
  highlight: {
    title: "A bought model's first import may need a retry",
    text: "Toymakr3D watermarks the files of a model you bought and builds its zip the first time it's asked for. If an import says it's still being built, wait a minute and import it again.",
  },
} satisfies ProviderDocs;
