// Its own mark is grey in shades of opacity; these are the greens of its favicon, face by face.
import type { ProviderManifest } from "../_lib/types";

export default {
  id: "crealitycloud",
  name: "Creality Cloud",
  order: 7,
  site: "https://www.crealitycloud.com",
  docsSlug: "creality-cloud",
  hosts: ["crealitycloud.com"],
  brand: {
    logo: {
      viewBox: "0 -30 1084 1084",
      color: "#06AE4A",
      path: "M271.36 0L542.117647 185.012706l-271.058823 183.115294-271.058824-183.115294z",
      layers: [
        { color: "#31BA4F", d: "M0 185.012706l271.058824 183.115294 0.421647 472.847059L0 661.985882z" },
        { color: "#005F33", d: "M812.634353 0L1084.235294 185.012706l-271.058823 183.175529-271.058824-183.175529z" },
        {
          color: "#116A2A",
          d: "M1084.235294 185.012706l-271.088941 183.115294-1.385412 474.473412L1084.235294 661.985882z",
        },
        {
          color: "#127136",
          d: "M542.117647 185.012706l271.058824 183.115294-270.968471 186.729412L271.058824 368.128z",
        },
        { color: "#1F813A", d: "M813.176471 368.128l-270.968471 186.729412L542.087529 1024l269.70353-181.398588z" },
        { color: "#2AA545", d: "M271.058824 368.128l270.998588 186.729412L542.117647 1024l-271.058823-183.055059z" },
      ],
    },
    chip: { bg: "#1AC686" },
  },
  signIn: "user",
  helpers: { grab: "recommended", flaresolverr: "none" },
  capabilities: {
    collections: true,
    likes: true,
    profiles: true,
    paidModels: false,
    categoryIds: "int",
    trending: { kind: "recommended", moreUrl: "https://www.crealitycloud.com/", rank: 8 },
  },
  errorCodes: { session: "crealitycloud_session" },
  extension: { site: "optional", origins: ["*://*.crealitycloud.com/*"] },
} as const satisfies ProviderManifest;
