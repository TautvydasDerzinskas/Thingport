import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "your own API key, and your browser's sign-in for files.",
  description: "Import free and bought Cults3D models, likes and printlists with your API key and browser sign-in.",
  signIn: "Your API key + browser sign-in",
  collections: "Printlists",
  note: {
    text: "Cults3D's files need your browser's Cloudflare clearance, and Thingport on the same IP address as that browser.",
    on: ["grab"],
  },
} satisfies ProviderDocs;
