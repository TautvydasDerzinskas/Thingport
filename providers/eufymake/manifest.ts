// Its app icon: the green M of its Make it Real site on a black hexagon, which keeps the pale green legible on light
// backgrounds.
import type { ProviderManifest } from "../_lib/types";

export default {
  id: "eufymake",
  name: "eufyMake",
  order: 11,
  site: "https://makeitreal.eufymake.com",
  docsSlug: "eufymake",
  hosts: ["makeitreal.eufymake.com"],
  endpoints: { api: "https://aiot-wapi-eu.ankermake.com/web/modelbase" },
  brand: {
    logo: {
      color: "#000000",
      path: "M12 0.5L21.959 6.25L21.959 17.75L12 23.5L2.041 17.75L2.041 6.25Z",
      layers: [
        {
          d: "M12.135 11.74C12.061 11.669 11.941 11.669 11.868 11.74L10.503 13.073C10.43 13.145 10.43 13.262 10.503 13.334L11.868 14.666C11.941 14.738 12.061 14.738 12.135 14.666L13.499 13.334C13.573 13.262 13.573 13.145 13.499 13.073L12.135 11.74ZM11.443 11.066L9.059 8.738L7.763 7.473H6.75V9.671V17.327H9.059V11.925L9.811 12.66C9.884 12.731 10.004 12.731 10.078 12.66L11.442 11.327C11.517 11.255 11.517 11.138 11.443 11.066ZM16.237 7.473L14.941 8.738L12.558 11.066C12.484 11.137 12.484 11.255 12.558 11.326L13.922 12.659C13.996 12.73 14.116 12.73 14.189 12.659L14.941 11.924V17.326H17.25V9.671V7.473H16.237Z",
          color: "#88F387",
        },
      ],
    },
    accent: "#88F387",
  },
  signIn: "userOptional",
  auth: [
    {
      slot: "default",
      scope: "user",
      fields: [{ name: "token", multiline: true }],
      legacyEndpoint: { path: "eufymake-session", method: "PATCH" },
    },
  ],
  modelNoun: "models",
  helpers: { grab: "recommended", flaresolverr: "none" },
  slicers: ["eufystudio3d"],
  capabilities: {
    collections: false,
    likes: true,
    profiles: false,
    paidModels: false,
    ownLists: "signIn",
    categoryIds: "number",
    trending: { kind: "featured", moreUrl: "https://makeitreal.eufymake.com/", rank: 11 },
  },
  examples: {
    model: "https://makeitreal.eufymake.com/models/be7c829023dd11f19919128e55eac07e/phone stand/",
    list: "https://makeitreal.eufymake.com/user/me/",
    browse: "https://makeitreal.eufymake.com/user/me/",
  },
  errorCodes: { session: "eufymake_session" },
  extension: { site: "optional", origins: ["*://makeitreal.eufymake.com/*"] },
} as const satisfies ProviderManifest;
