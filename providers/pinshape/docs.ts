import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "your own sign-in, for the files; collections and likes read without it.",
  about:
    "One of the older community libraries: started in Vancouver in 2013, bought by Formlabs three years on, and run by MatterHackers now. Everything on it is free, and its collections are anyone's to follow.",
  description: "Import Pinshape models, and anyone's collections and likes, with your own sign-in for the files.",
  signIn: "Yours, for the files",
  highlight: {
    title: "Models come in without a category",
    text: "Pinshape's pages don't say which of its categories a model is in, so it comes in without one. Pick one yourself, or let AI categorization choose one on import, once an admin turns it on.",
    link: "guides/ai#ai-categorization",
  },
} satisfies ProviderDocs;
