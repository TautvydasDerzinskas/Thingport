import { afterEach, describe, expect, it } from "vitest";
import {
  fetchPrintSocialCollectionCards,
  fetchPrintSocialList,
  isPrintSocialFileHost,
  parsePrintSocialCollectionUrl,
  parsePrintSocialCreatorUrl,
  parsePrintSocialModelUrl,
  printSocialListCard,
  printSocialListFromPage,
  printSocialModelFromPage,
  printSocialSlugFrom,
  resolvePrintSocialCreator,
  resolvePrintSocialModel,
} from "../src/providers/threedprintsocial/api";
import { modelIdFromUrl, modelUrlFor, parseSyncSource } from "../src/services/collectionSyncService";
import { html, installFetch, loadFixtureHtml, redirect, type FetchStub } from "./providers/support";

// The 3DPrint.social client against pages in the shapes its Manyfold templates render
// (fixtures/providers/threedprintsocial), with fetch stubbed. No database.

const P = "threedprintsocial";

let stub: FetchStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

describe("3DPrint.social links", () => {
  it("reads model pages by their public id", () => {
    expect(parsePrintSocialModelUrl("https://3dprint.social/models/xc68zh951g26")).toEqual({ modelId: "xc68zh951g26" });
    expect(parsePrintSocialModelUrl("https://www.3dprint.social/models/xc68zh951g26/")).toEqual({
      modelId: "xc68zh951g26",
    });
    expect(parsePrintSocialModelUrl("https://3dprint.social/models/xc68zh951g26.zip")).toBeNull();
    expect(parsePrintSocialModelUrl("https://3dprint.social/models/new")).toBeNull();
    expect(parsePrintSocialModelUrl("https://3dprint.social.evil.test/models/xc68zh951g26")).toBeNull();
    expect(modelIdFromUrl(P, modelUrlFor(P, "xc68zh951g26"))).toBe("xc68zh951g26");
  });

  it("reads a collection's page, and the models page filtered to it", () => {
    expect(parsePrintSocialCollectionUrl("https://3dprint.social/collections/krfflpzgbtvf")).toEqual({
      collectionId: "krfflpzgbtvf",
    });
    expect(parsePrintSocialCollectionUrl("https://3dprint.social/models?collection=krfflpzgbtvf")).toEqual({
      collectionId: "krfflpzgbtvf",
    });
    expect(parsePrintSocialCollectionUrl("https://3dprint.social/collections")).toBeNull();
    expect(parsePrintSocialCollectionUrl("https://3dprint.social/collections/new")).toBeNull();
  });

  it("reads a creator's page, and syncs their models like a collection", () => {
    expect(parsePrintSocialCreatorUrl("https://3dprint.social/creators/maker-one")).toEqual({ slug: "maker-one" });
    expect(parsePrintSocialCreatorUrl("https://3dprint.social/models?creator=maker_one")).toEqual({
      slug: "maker_one",
    });
    expect(parsePrintSocialCreatorUrl("https://3dprint.social/creators/new")).toBeNull();
    expect(parseSyncSource("https://3dprint.social/creators/maker-one")).toMatchObject({
      provider: P,
      externalId: "creator:maker-one",
      url: "https://3dprint.social/creators/maker-one",
    });
  });

  it("takes a creator as their handle, Fediverse address or page", () => {
    expect(printSocialSlugFrom("maker-one")).toBe("maker-one");
    expect(printSocialSlugFrom("@maker-one")).toBe("maker-one");
    expect(printSocialSlugFrom("@maker-one@3dprint.social")).toBe("maker-one");
    expect(printSocialSlugFrom("https://3dprint.social/creators/maker-one")).toBe("maker-one");
    expect(printSocialSlugFrom("@maker-one@mastodon.social")).toBeNull();
    expect(printSocialSlugFrom("https://3dprint.social/models/xc68zh951g26")).toBeNull();
  });

  it("downloads files from the site itself only", () => {
    expect(isPrintSocialFileHost("3dprint.social")).toBe(true);
    expect(isPrintSocialFileHost("files.example.com")).toBe(false);
  });
});

describe("3DPrint.social model pages", () => {
  const model = printSocialModelFromPage(loadFixtureHtml(P, "model-page"), "xc68zh951g26")!;

  it("reads the title, description and tags without their counts", () => {
    expect(model.meta.title).toBe("H2 housing");
    expect(model.meta.description).toContain("A snap-fit housing for the H2 sensor board.");
    expect(model.meta.description).toContain("**no supports**");
    expect(model.meta.tags).toEqual(["enclosure", "electronics", "Snap Fit"]);
  });

  it("reads its creator by their slug", () => {
    expect(model.meta.creator).toBe("Maker One");
    expect(model.meta.author).toMatchObject({
      provider: P,
      externalId: "maker-one",
      name: "Maker One",
      links: ["https://3dprint.social/creators/maker-one"],
    });
  });

  it("keeps its pictures at full size, its preview first", () => {
    expect(model.meta.previewImageUrl).toBe("https://3dprint.social/models/xc68zh951g26/model_files/q2w3e4r5t6y7.jpg");
    expect(model.galleryImages).toEqual([
      {
        url: "https://3dprint.social/models/xc68zh951g26/model_files/q2w3e4r5t6y7.jpg",
        filename: "Housing front.jpg",
      },
      {
        url: "https://3dprint.social/models/xc68zh951g26/model_files/z9x8c7v6b5n4.png",
        filename: "Housing back.png",
      },
    ]);
  });

  it("lists every file in every group by its download link, named by its own filename", () => {
    expect(model.files).toEqual([
      { name: "H2 housing.stl", url: "https://3dprint.social/models/xc68zh951g26/raw/H2%20housing.stl?download=true" },
      {
        name: "Assembly notes.pdf",
        url: "https://3dprint.social/models/xc68zh951g26/raw/Assembly%20notes.pdf?download=true",
      },
      { name: "H2 lid.stl", url: "https://3dprint.social/models/xc68zh951g26/raw/lid/H2%20lid.stl?download=true" },
    ]);
  });

  it("isn't a model page when it hasn't the model in it", () => {
    expect(printSocialModelFromPage(loadFixtureHtml(P, "creator-page"), "xc68zh951g26")).toBeNull();
  });

  it("answers a missing model, and one that isn't public, with null", async () => {
    stub = installFetch(({ url }) =>
      url.pathname === "/models/aaaaaaaaaaaa" ? new Response("Not found", { status: 404 }) : redirect("/users/sign_in"),
    );
    expect(await resolvePrintSocialModel("aaaaaaaaaaaa")).toBeNull();
    expect(await resolvePrintSocialModel("bbbbbbbbbbbb")).toBeNull();
  });

  it("throws on an outage rather than calling the model gone", async () => {
    stub = installFetch(() => new Response("down", { status: 502 }));
    await expect(resolvePrintSocialModel("xc68zh951g26")).rejects.toThrow(/HTTP 502/);
  });
});

describe("3DPrint.social lists", () => {
  it("reads a collection's name, owner, count and own models, leaving out those of other servers", () => {
    const page = printSocialListFromPage(loadFixtureHtml(P, "collection-page"), {
      kind: "collection",
      collectionId: "krfflpzgbtvf",
    })!;
    expect(page.info).toEqual({ name: "3D Printer Mods", owner: "Maker One" });
    expect(page.total).toBe(5);
    expect(page.pages).toBe(2);
    expect(page.entries).toEqual([
      {
        modelId: "xc68zh951g26",
        title: "H2 housing",
        cover: "https://3dprint.social/models/xc68zh951g26/model_files/ac68zh951g26.jpg",
      },
      {
        modelId: "nvc523dlrs6j",
        title: "Practice pedal",
        cover: "https://3dprint.social/models/nvc523dlrs6j/model_files/avc523dlrs6j.jpg",
      },
      { modelId: "0z5pm6904602", title: "Hexpansion template", cover: null },
    ]);
  });

  it("reads every page of a collection", async () => {
    stub = installFetch(({ url }) =>
      url.pathname === "/collections/krfflpzgbtvf"
        ? html(loadFixtureHtml(P, url.searchParams.get("page") === "2" ? "collection-page-2" : "collection-page"))
        : undefined,
    );
    const list = await fetchPrintSocialList({ kind: "collection", collectionId: "krfflpzgbtvf" });
    expect(list?.entries.map((entry) => entry.modelId)).toEqual([
      "xc68zh951g26",
      "nvc523dlrs6j",
      "0z5pm6904602",
      "whv4ph9w9ctv",
    ]);
    // The federated one is counted, but can't be imported.
    expect(list?.total).toBe(5);
    expect(list?.truncated).toBe(true);
  });

  it("answers a collection that's gone with null", async () => {
    stub = installFetch(() => new Response("Not found", { status: 404 }));
    expect(await fetchPrintSocialList({ kind: "collection", collectionId: "krfflpzgbtvf" })).toBeNull();
  });

  it("reads a creator's models, named after them", async () => {
    stub = installFetch(({ url }) =>
      url.pathname === "/creators/maker-one" ? html(loadFixtureHtml(P, "creator-page")) : undefined,
    );
    expect(await printSocialListCard({ kind: "creator", slug: "maker-one" })).toEqual({
      id: "creator:maker-one",
      name: "Maker One on 3DPrint.social",
      url: "https://3dprint.social/creators/maker-one",
      modelCount: 2,
      thumbnails: [
        "https://3dprint.social/models/xc68zh951g26/model_files/ac68zh951g26.jpg",
        "https://3dprint.social/models/w35tk0prbf7h/model_files/a35tk0prbf7h.jpg",
      ],
      private: false,
      owner: "Maker One",
    });
    expect(await resolvePrintSocialCreator("maker-one")).toEqual({ slug: "maker-one", name: "Maker One" });
  });

  it("reads a creator's collections", async () => {
    stub = installFetch(({ url }) =>
      url.pathname === "/collections" && url.searchParams.get("creator") === "maker-one"
        ? html(loadFixtureHtml(P, "creator-collections"))
        : undefined,
    );
    const cards = await fetchPrintSocialCollectionCards("maker-one");
    expect(cards.map((card) => [card.id, card.name, card.modelCount, card.owner, card.thumbnails.length])).toEqual([
      ["krfflpzgbtvf", "3D Printer Mods", 5, "Maker One", 1],
      ["bq7x2m9k4d1s", "Household Items", 19, "Maker One", 0],
    ]);
    expect(stub.calls).toHaveLength(1);
  });
});
