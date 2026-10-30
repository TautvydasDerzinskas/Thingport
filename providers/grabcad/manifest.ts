// Its favicon's mark: "GC", the G in the type's own dark (here the text colour, so it reads on either theme) and the C
// in its red, drawn from the G and the C of its wordmark.
import type { ProviderManifest } from "../_lib/types";

export default {
  id: "grabcad",
  name: "GrabCAD",
  order: 17,
  site: "https://grabcad.com",
  docsSlug: "grabcad",
  hosts: ["grabcad.com"],
  // What its library pages call. Its files are on the site's own host.
  endpoints: { api: "https://grabcad.com/community/api/v1" },
  brand: {
    logo: {
      viewBox: "0 0 28 28",
      color: "currentColor",
      path:
        "M7.3676 15.2079H11.89V18.8534C10.7265 19.4683 9.3874 20.0173 7.214 20.0173C4.382 20.0173 2.0769 18.524 2.0769 " +
        "16.0424V11.8479C2.0769 9.4541 4.5137 8.0047 7.3457 8.0047C9.3874 8.0047 11.2754 8.5538 12.5267 9.4102L13.317 " +
        "7.9608C11.912 6.9726 9.6508 6.3137 7.2798 6.3137C3.416 6.3137 0.145 8.3561 0.145 11.6722V16.2181C0.145 19.5342 " +
        "3.2185 21.6863 7.214 21.6863C10.3094 21.6863 12.2852 20.7859 13.8219 19.8855V13.6047H7.3676V15.2079Z",
      layers: [
        {
          d:
            "M22.2816 9.1467C24.1257 9.1467 25.4648 9.542 26.6284 10.2228L27.8578 7.8071C26.2113 6.731 24.5867 6.3137 " +
            "22.0621 6.3137C18.33 6.3137 15.1468 8.4 15.1468 11.8259V16.1522C15.1468 19.8416 18.0885 21.6863 22.084 " +
            "21.6863C24.6526 21.6863 26.1234 21.313 27.7041 20.3467L26.5845 17.8651C25.4649 18.5679 23.972 18.8753 " +
            "22.3036 18.8753C20.1082 18.8753 18.4837 18.0189 18.4837 15.9765V12.0236C18.4837 10.1788 20.2619 9.1467 " +
            "22.2816 9.1467Z",
          color: "#E63B2D",
        },
      ],
    },
    accent: "#E63B2D",
  },
  // Its models, their file lists and anyone's likes are anyone's to read; downloading a file takes a signed-in user.
  signIn: "user",
  // Rails' session cookie is the whole sign-in: there's no remember-me cookie beside it. A visitor gets one too.
  sessionCookies: { session: "_grabcad_session" },
  auth: [{ slot: "default", scope: "user", fields: [{ name: "session", multiline: true }] }],
  modelNoun: "models",
  helpers: { grab: "recommended", flaresolverr: "none" },
  capabilities: {
    // Its community has no collections of models; a member's likes are its only list.
    collections: false,
    likes: true,
    profiles: false,
    paidModels: false,
    ownLists: "signIn",
    // A category is the slug its library names it by (`3d-printing`); a model's details give no number for it.
    categoryIds: "path",
    // Its library's own "Popular" sort, narrowed to its 3D printing category and the models with STL files.
    trending: {
      kind: "popular",
      moreUrl: "https://grabcad.com/library/category/3d-printing/software/stl?sort=popular",
      rank: 16,
    },
  },
  examples: {
    model: "https://grabcad.com/library/arduino-uno-r3-1",
    list: "https://grabcad.com/andrew_whitham-1/likes",
    browse: "https://grabcad.com/…/likes",
  },
  errorCodes: { session: "grabcad_session" },
  extension: { site: "optional", origins: ["*://grabcad.com/*", "*://*.grabcad.com/*"] },
} as const satisfies ProviderManifest;
