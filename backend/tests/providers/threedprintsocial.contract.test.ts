import { describe, expect, it, vi } from "vitest";
import { printSocialBrowse } from "../../src/providers/threedprintsocial/browse";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import { binary, expectStatus, html, loadFixtureHtml, stl, type FetchHandler } from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// 3DPrint.social end to end, from its pages: it's a Manyfold server, and anything public on it -- models, their
// files, collections and creators -- is anyone's to read. Its pages are written in the shapes its Manyfold templates
// render (fixtures/providers/threedprintsocial), its users renamed.

const P = "threedprintsocial";
const MODEL_URL = "https://3dprint.social/models/xc68zh951g26";
const COLLECTION_URL = "https://3dprint.social/collections/krfflpzgbtvf";
const COLLECTION_IDS = ["xc68zh951g26", "nvc523dlrs6j", "0z5pm6904602", "whv4ph9w9ctv"];

function handlerFor(scenario: string): FetchHandler {
  return ({ url }) => {
    if (url.hostname !== "3dprint.social") return undefined;
    const path = url.pathname;
    if (path === "/models/xc68zh951g26") {
      return scenario === "missing"
        ? new Response("Not found", { status: 404 })
        : html(loadFixtureHtml(P, "model-page"));
    }
    const raw = path.match(/^\/models\/xc68zh951g26\/raw\/(.+)$/)?.[1];
    if (raw) return binary(stl(decodeURIComponent(raw).split("/").pop()!));
    if (path === "/collections/krfflpzgbtvf") {
      if (scenario === "gone") return new Response("Not found", { status: 404 });
      return html(loadFixtureHtml(P, url.searchParams.get("page") === "2" ? "collection-page-2" : "collection-page"));
    }
    if (path === "/creators/maker-one") return html(loadFixtureHtml(P, "creator-page"));
    if (path === "/collections" && url.searchParams.get("creator") === "maker-one") {
      return html(loadFixtureHtml(P, "creator-collections"));
    }
    return undefined;
  };
}

const spec: ProviderContractSpec = {
  id: P,
  name: "3DPrint.social",
  modelUrl: MODEL_URL,
  expected: {
    externalId: "xc68zh951g26",
    title: "H2 housing",
    notesIncludes: "A snap-fit housing for the H2 sensor board.",
    author: "Maker One",
    tags: ["Electronics", "Enclosure", "Snap fit"],
    // Its models have tags, but no categories.
    category: null,
    galleryImages: 2,
    plateInstanceIds: [null, null],
    plateFilenames: ["H2 housing.stl", "H2 lid.stl"],
  },
  // Nothing to connect.
  connect: async () => undefined,
  disconnect: async () => undefined,
  createHandler: (scenario) => handlerFor(scenario),
  reimport: {},
  list: {
    endpoint: `/api/import/${P}/list/entries`,
    url: COLLECTION_URL,
    title: "3D Printer Mods",
    importedId: "xc68zh951g26",
    freshId: "nvc523dlrs6j",
  },
  // Its collections are anyone's to read, over pages of 12.
  listing: { sync: { externalId: "krfflpzgbtvf", sourceUrl: COLLECTION_URL }, ids: COLLECTION_IDS, needsSignIn: false },
  skip: {
    missingCredentials: "3DPrint.social has no sign-in: its public models and their files are anyone's",
    rejectedCredentials: "3DPrint.social has no sign-in: its public models and their files are anyone's",
  },
};

const ctx = describeProviderContract(spec);

describe("3DPrint.social specifics", () => {
  it("answers a model 3DPrint.social doesn't have with 404", async () => {
    ctx.stub("missing");
    expect((await ctx.importUrl()).status).toBe(404);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("downloads only the files a plate takes, one by one, never the zip of them all", async () => {
    const stub = ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    const asked = stub.callsTo("3dprint.social").map((call) => call.url.pathname);
    expect(asked.filter((path) => path.includes("/raw/"))).toEqual([
      "/models/xc68zh951g26/raw/H2%20housing.stl",
      "/models/xc68zh951g26/raw/lid/H2%20lid.stl",
    ]);
    expect(asked.some((path) => path.endsWith(".zip"))).toBe(false);
  });

  it("lists a creator's models from their page, named after them", async () => {
    ctx.stub("ok");
    const res = await ctx.post(spec.list!.endpoint, { url: "https://3dprint.social/creators/maker-one" });
    expectStatus(res, 200);
    expect(res.body.title).toBe("Maker One on 3DPrint.social");
    expect(res.body.entries.map((entry: { design_id: string }) => entry.design_id)).toEqual([
      "xc68zh951g26",
      "w35tk0prbf7h",
    ]);
  });

  it("asks who the user is before the Browse tab can list their models and collections", async () => {
    ctx.stub("ok");
    await printSocialBrowse.setAccount!(ctx.userId, null);
    await expect(printSocialBrowse.cards(ctx.userId)).rejects.toMatchObject({ status: 409 });

    await printSocialBrowse.setAccount!(ctx.userId, "@maker-one@3dprint.social");
    expect(await printSocialBrowse.account(ctx.userId)).toEqual({ connected: true, account: "maker-one" });
    const cards = await printSocialBrowse.cards(ctx.userId);
    expect(cards.map((card) => [card.id, card.name, card.modelCount])).toEqual([
      ["creator:maker-one", "Maker One on 3DPrint.social", 2],
      ["krfflpzgbtvf", "3D Printer Mods", 5],
      ["bq7x2m9k4d1s", "Household Items", 19],
    ]);
  });

  it("turns down a creator it hasn't got", async () => {
    ctx.install(() => new Response("Not found", { status: 404 }));
    await expect(printSocialBrowse.setAccount!(ctx.userId, "nobody-here")).rejects.toMatchObject({ status: 404 });
    await expect(printSocialBrowse.setAccount!(ctx.userId, "@x@mastodon.social")).rejects.toMatchObject({
      status: 400,
    });
  });
});
