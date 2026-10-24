import { describe, expect, it } from "vitest";
import { MANIFESTS, PROVIDER_IDS } from "../src/providers/_generated";
import { PROVIDERS, SESSION_CODES } from "../src/providers/registry";

describe("provider registry", () => {
  it("imports profiles exactly for the providers whose manifest says they have them", () => {
    const sourced = PROVIDER_IDS.filter((id) => PROVIDERS[id].sourcedImport);
    expect(sourced.map((id) => [id, Boolean(PROVIDERS[id].sourcedImport!.profiles)])).toEqual(
      sourced.map((id) => [id, MANIFESTS[id].capabilities.profiles]),
    );
  });

  it("names its own provider in the text of a sign-in that stopped a batch", () => {
    const signedIn = PROVIDER_IDS.filter((id) => id !== "makerworld" && "session" in MANIFESTS[id].errorCodes);
    expect(signedIn.filter((id) => !PROVIDERS[id].authStopText.includes(MANIFESTS[id].name.split(" ")[0]))).toEqual([]);
    expect(SESSION_CODES.has("nexprint_session")).toBe(true);
  });
});
