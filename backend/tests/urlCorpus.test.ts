import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { identifySourceModel } from "../src/services/importService";
import { parseSyncSource } from "../src/services/collectionSyncService";
import { parseMakerworldModelUrl } from "../src/services/makerworldCloudApi";
import { parseSnapmakerModelUrl } from "../src/services/snapmakerApi";
import { parseMakeronlineModelUrl, isMakeronlineLikesUrl } from "../src/services/makeronlineApi";
import { parseCrealitycloudModelUrl, parseCrealitycloudLikesUrl } from "../src/services/crealitycloudApi";
import { parseNexprintModelUrl } from "../src/services/nexprintApi";
import { parseThingiverseLikesUrl } from "../src/services/thingiverseApi";
import { parsePrintablesLikesUrl } from "../src/services/printablesApi";
import { isThangsLikesUrl } from "../src/services/thangsApi";
import { parseCults3dLikesUrl } from "../src/services/cults3dApi";
import { parseSnapmakerListUrl } from "../src/services/snapmakerApi";

type Expected = {
  provider: string | null;
  kind: "model" | "list" | null;
  externalId?: string;
  requestedProfileId?: string;
  listKind?: "collection" | "likes" | "bookmarks";
};
type Case = { url: string; expect: Expected; divergent?: { backend?: Expected | null } };

const root = path.resolve(__dirname, "../../providers");
const cases = fs
  .readdirSync(root, { withFileTypes: true })
  .flatMap((entry) =>
    entry.isDirectory() && !entry.name.startsWith("_")
      ? (JSON.parse(fs.readFileSync(path.join(root, entry.name, "urls.fixtures.json"), "utf8")) as Case[])
      : [],
  );

function profileOf(provider: string, url: string): string | null {
  // requestedProfileOf in importService is private; these are the same five exported parsers it delegates to.
  if (provider === "makerworld") return parseMakerworldModelUrl(url)?.requestedInstanceId ?? null;
  if (provider === "snapmaker") return parseSnapmakerModelUrl(url)?.requestedProfileId ?? null;
  if (provider === "makeronline") return parseMakeronlineModelUrl(url)?.requestedProfileId ?? null;
  if (provider === "crealitycloud") return parseCrealitycloudModelUrl(url)?.requestedProfileId ?? null;
  if (provider === "nexprint") return parseNexprintModelUrl(url)?.requestedProfileId ?? null;
  return null;
}

function listKindOf(provider: string, url: string): Expected["listKind"] {
  if (provider === "snapmaker") return parseSnapmakerListUrl(url)?.list ?? "collection";
  if (
    (provider === "thingiverse" && parseThingiverseLikesUrl(url)) ||
    (provider === "printables" && parsePrintablesLikesUrl(url)) ||
    (provider === "makeronline" && isMakeronlineLikesUrl(url)) ||
    (provider === "crealitycloud" && parseCrealitycloudLikesUrl(url)) ||
    (provider === "thangs" && isThangsLikesUrl(url)) ||
    (provider === "cults3d" && parseCults3dLikesUrl(url))
  )
    return "likes";
  return "collection";
}

describe("provider URL corpus (backend)", () => {
  it("contains every provider and both positive and negative cases", () => {
    expect(cases).toHaveLength(57);
    expect(new Set(cases.map((item) => item.expect.provider).filter(Boolean)).size).toBe(10);
  });

  it.each(cases)("$url", ({ url, expect: common, divergent }) => {
    const expected =
      divergent?.backend === null ? { provider: null, kind: null } : { ...common, ...divergent?.backend };
    const model = identifySourceModel(url);
    const list = parseSyncSource(url);
    const actual: Expected = model
      ? { provider: model.provider, kind: "model", externalId: model.externalId }
      : list
        ? {
            provider: list.provider,
            kind: "list",
            externalId: list.externalId,
            listKind: listKindOf(list.provider, url),
          }
        : { provider: null, kind: null };
    if (model) {
      const profile = profileOf(model.provider, url);
      if (profile !== null) actual.requestedProfileId = profile;
    }
    expect(actual).toEqual(expected);
  });
});
