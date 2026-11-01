// GENERATED from providers/*/manifest.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.

/** Destinations that may receive provider credentials. URL recognition is deliberately broader. */
export const CREDENTIAL_HOSTS = {
  "makerworld-page": {
    exact: ["makerworld.com", "www.makerworld.com"],
  },
  "makerworld-extension": {
    exact: ["makerworld.com"],
  },
  "makerworld-cloud": {
    exact: ["api.bambulab.com"],
  },
  "printables-api": {
    exact: ["api.printables.com"],
  },
  "thingiverse-api": {
    exact: ["api.thingiverse.com"],
  },
  "myminifactory-api": {
    exact: ["www.myminifactory.com"],
  },
  "myminifactory-session": {
    exact: ["www.myminifactory.com"],
  },
  "snapmaker-api": {
    exact: ["api-models.snapmaker.com"],
  },
  "snapmaker-id": {
    exact: ["id.snapmaker.com"],
  },
  "makeronline-api": {
    exact: ["www.makeronline.com"],
  },
  "makeronline-site": {
    exact: ["makeronline.com", "www.makeronline.com"],
  },
  "crealitycloud-api": {
    exact: ["www.crealitycloud.com"],
  },
  "nexprint-api": {
    exact: ["www.nexprint.com"],
  },
  "thangs-api": {
    exact: ["thangs.com"],
  },
  "thangs-site": {
    exact: ["thangs.com", "www.thangs.com"],
  },
  "cults3d-api": {
    exact: ["cults3d.com"],
  },
  "cults3d-session": {
    exact: ["cults3d.com"],
  },
  "eufymake-api": {
    exact: ["aiot-wapi-eu.ankermake.com"],
  },
  "pinshape-session": {
    exact: ["pinshape.com"],
  },
  "toymakr3d-session": {
    exact: ["www.toymakr3d.com"],
  },
  "makerables-api": {
    exact: ["www.makerables.com"],
  },
  "makerables-session": {
    exact: ["www.makerables.com"],
  },
  "cgtrader-session": {
    exact: ["www.cgtrader.com"],
  },
  "grabcad-session": {
    exact: ["grabcad.com"],
  },
} as const;
export type CredentialDestination = keyof typeof CREDENTIAL_HOSTS;
