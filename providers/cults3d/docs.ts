import type { ProviderDocs } from "../_lib/types";

export default {
  summary: "your own API key, and your browser's sign-in for files.",
  about:
    "An independent French marketplace for free and paid designs, going since 2014. It sells model by model rather than by subscription, and leans towards figurines, cosplay props and jewellery.",
  description: "Import free and bought Cults3D models, likes and printlists with your API key and browser sign-in.",
  signIn: "Your API key + browser sign-in",
  collections: "Printlists",
  note: {
    text: "Cults3D's files need your browser's Cloudflare clearance, and Thingport on the same IP address as that browser.",
    on: ["grab"],
  },
  highlight: {
    title: "Thingport must use the same IP as your browser",
    text: "Cults3D's files need your browser's Cloudflare clearance, which Thingport Grab sends as you visit cults3d.com signed in. Cloudflare ties it to your IP address, which a server at home shares.",
    link: "grab#cults3d-your-api-key-and-the-browsers-sign-in",
  },
} satisfies ProviderDocs;
