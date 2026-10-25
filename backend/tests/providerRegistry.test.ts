import { describe, expect, it } from "vitest";
import { MANIFESTS, PROVIDER_IDS, type ProviderManifest } from "../src/providers/index.generated";
import { profilesImportJob } from "../src/services/importJobRunner";
import { PROVIDERS, SESSION_CODES } from "../src/providers/registry";

describe("provider registry", () => {
  it("imports profiles exactly for the providers whose manifest says they have them", () => {
    const sourced = PROVIDER_IDS.filter((id) => PROVIDERS[id].sourcedImport);
    expect(sourced.map((id) => [id, Boolean(PROVIDERS[id].sourcedImport!.profiles)])).toEqual(
      sourced.map((id) => [id, MANIFESTS[id].capabilities.profiles]),
    );
  });

  it("imports lists exactly for the providers whose manifest says they have collections or likes", () => {
    expect(PROVIDER_IDS.filter((id) => PROVIDERS[id].lists)).toEqual(
      PROVIDER_IDS.filter((id) => MANIFESTS[id].capabilities.collections || MANIFESTS[id].capabilities.likes),
    );
  });

  it("keeps a profiles endpoint from before only for providers whose profiles import together", () => {
    const legacy = (id: (typeof PROVIDER_IDS)[number]): ProviderManifest["legacy"] => MANIFESTS[id].legacy;
    expect(PROVIDER_IDS.filter((id) => legacy(id)?.profiles)).toEqual(
      PROVIDER_IDS.filter((id) => profilesImportJob(id)),
    );
  });

  it("names its own provider in the text of a sign-in that stopped a batch", () => {
    const signedIn = PROVIDER_IDS.filter((id) => id !== "makerworld" && "session" in MANIFESTS[id].errorCodes);
    expect(signedIn.filter((id) => !PROVIDERS[id].authStopText.includes(MANIFESTS[id].name.split(" ")[0]))).toEqual([]);
    expect(SESSION_CODES.has("nexprint_session")).toBe(true);
  });
});
