// A white S on a black disc; the S is cut out instead, so the disc can take the text colour.
// id.snapmaker.com renews the sign-in (Grab's snapmakerSession.ts); Grab's panel only ever shows on Snapmaker Space.
import type { ProviderManifest } from "../_lib/types";

export default {
  id: "snapmaker",
  name: "Snapmaker Space",
  order: 5,
  site: "https://space.snapmaker.com",
  docsSlug: "snapmaker-space",
  hosts: ["snapmaker.com"],
  brand: {
    logo: {
      viewBox: "0 0 36 36",
      color: "currentColor",
      path: "M18 0a18 18 0 1 0 0 36a18 18 0 1 0 0-36ZM23.2899 9.13976C21.7574 8.82421 20.5055 9.02036 19.5311 9.72254C18.5567 10.4247 17.8864 11.6016 17.5232 13.2505L16.3835 18.396H16.3864L15.3677 22.9928C15.1758 23.8627 14.8864 24.4711 14.5026 24.8207C14.1187 25.1704 13.5842 25.2727 12.9022 25.1334C12.4593 25.0425 11.9868 24.8776 11.4789 24.6388L10.9238 27.1291C11.414 27.3792 12.0104 27.5754 12.7132 27.7175C14.2457 28.0331 15.4976 27.8369 16.472 27.1348C17.4464 26.4326 18.1167 25.2557 18.4799 23.6068L19.6197 18.4613H19.6167L20.6354 13.8645C20.8273 12.9946 21.1167 12.3863 21.5006 12.0366C21.8844 11.6869 22.4189 11.5846 23.1009 11.7239C23.5439 11.8148 24.0163 11.9797 24.5242 12.2185L25.0763 9.72538C24.5891 9.4809 23.9927 9.28475 23.2899 9.13976Z",
      fillRule: "evenodd",
    },
    chip: { bg: "#0C63E2" },
  },
  signIn: "user",
  helpers: { grab: "recommended", flaresolverr: "none" },
  capabilities: { collections: true, likes: true, profiles: true, paidModels: false, categoryIds: "int" },
  errorCodes: { session: "snapmaker_session" },
  extension: { site: "optional", origins: ["*://space.snapmaker.com/*", "*://id.snapmaker.com/*"] },
} as const satisfies ProviderManifest;
