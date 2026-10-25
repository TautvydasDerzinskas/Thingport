// GENERATED from providers/_lib/credentialHosts.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
/** Hosts allowed to receive provider credentials. URL parsers may accept a different set of page hosts. */
export const CREDENTIAL_HOSTS = {
  "makerworld-page": { exact: ["makerworld.com", "www.makerworld.com"] },
  "makerworld-extension": { exact: ["makerworld.com"] },
  "makerworld-cloud": { exact: ["api.bambulab.com"] },
  "thingiverse-api": { exact: ["api.thingiverse.com"] },
  "myminifactory-api": { exact: ["www.myminifactory.com"] },
  "myminifactory-session": { exact: ["www.myminifactory.com"] },
  "snapmaker-api": { exact: ["api-models.snapmaker.com"] },
  "makeronline-api": { exact: ["www.makeronline.com"] },
  "makeronline-site": { exact: ["makeronline.com", "www.makeronline.com"] },
  "crealitycloud-api": { exact: ["www.crealitycloud.com"] },
  "eufymake-api": { exact: ["aiot-wapi-eu.ankermake.com"] },
  "nexprint-api": { exact: ["www.nexprint.com"] },
  "thangs-api": { exact: ["thangs.com"] },
  "cults3d-api": { exact: ["cults3d.com"] },
  "cults3d-session": { exact: ["cults3d.com"] },
  "printables-api": { exact: ["api.printables.com"] },
  "snapmaker-id": { exact: ["id.snapmaker.com"] },
  "thangs-site": { exact: ["thangs.com", "www.thangs.com"] },
} as const;

export type CredentialDestination = keyof typeof CREDENTIAL_HOSTS;
