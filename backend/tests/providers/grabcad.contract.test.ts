import { describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db";
import {
  grabcadCategoryIds,
  grabcadGalleryFrom,
  grabcadLikesFromPage,
  type GrabcadFile,
} from "../../src/providers/grabcad/api";
import { grabcadBrowse } from "../../src/providers/grabcad/browse";
import { grabcadConnection } from "../../src/providers/grabcad/connection";
import { grabcadFilePicks, grabcadTrending } from "../../src/providers/grabcad";
import {
  getGrabcadConnection,
  normalizeGrabcadSession,
  setUserGrabcadSession,
} from "../../src/providers/grabcad/session";
import { fetchListing } from "../../src/services/collectionSyncRunner";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import { binary, expectStatus, html, json, loadFixture, loadFixtureHtml, stl, zip, type FetchHandler } from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// GrabCAD end to end, from its library's own API: a model's details, its gallery and its files folder by folder, each
// with the link that downloads it -- the one call that needs the user's sign-in. A member's likes are the pages their
// profile renders, anyone's to read. Its answers are the recorded shapes in fixtures/providers/grabcad, trimmed -- six
// of the model's files, three of its pictures, four of its tags, three likes over two pages -- and the signed-in
// member, and the one whose likes are read, renamed.

const SESSION = "d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f";
const SLUG = "arduino-uno-r3-1";
const MODEL_URL = `https://grabcad.com/library/${SLUG}`;
const API = "/community/api/v1";
const MEMBER = "maker.one-1";
const LIKES_URL = `https://grabcad.com/${MEMBER}/likes`;
const HUSKY = "husky-52-w-x-24-5-d-standard-duty-10-drawer-mobile-workbench-tool-chest-h52mwc10-1";
const GLASS = "cabernet-tulip-wine-glass-1";
const VISE = "vis-vba-1";
const RENDERINGS = 469358;

type FileRow = Record<string, unknown> & { name: string; download_url: string };
type Folder = { files: FileRow[]; folders: { id: number; name: string }[] };

/** A STEP file's bytes: plain ISO-10303-21 text. */
const step = (seed: string): Buffer =>
  Buffer.from(
    `ISO-10303-21;\nHEADER;\nFILE_NAME('${seed}','2026-01-01T00:00:00',(''),(''),'','','');\nENDSEC;\n` +
      `DATA;\n#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;\n`,
    "utf8",
  );

/** A file as its API lists it: a recorded row with another name, CAD system and id. */
function fileRow(name: string, system: string, cadid: string): FileRow {
  const row = loadFixture<Folder>("grabcad", "files").files[0];
  return {
    ...row,
    name,
    system,
    extension: name.split(".").pop()!.toLowerCase(),
    download_url: `https://grabcad.com${API}/models/${SLUG}/files/download?cadid=${cadid}`,
  };
}

/** `folders`: what a model's folders hold, by folder id ("root" for its top one), in place of the recorded ones.
 *  `zips`: what a zip holds, by its name. */
type Variant = { folders?: Record<string, Folder>; zips?: Record<string, Record<string, Buffer>> };

function handlerFor(scenario: string, variant: Variant = {}): FetchHandler {
  const folders: Record<string, Folder> = variant.folders ?? {
    root: loadFixture<Folder>("grabcad", "files"),
    [RENDERINGS]: loadFixture<Folder>("grabcad", "files-renderings"),
  };
  const byCadid = new Map(
    Object.values(folders)
      .flatMap((folder) => folder.files)
      .map((file) => [new URL(file.download_url).searchParams.get("cadid"), file.name]),
  );
  return async ({ url, headers, method }) => {
    if (url.hostname !== "grabcad.com") return undefined;
    const signedIn = headers.cookie === `_grabcad_session=${SESSION}` && scenario !== "rejected";
    const p = url.pathname;
    const file = p.match(/^\/cads\/files\/([0-9a-f]{32})\/original\.\w+$/);
    if (file) {
      const name = byCadid.get(file[1])!;
      const zipped = variant.zips?.[name];
      if (zipped) return binary(await zip(`grabcad:${name}`, zipped));
      return binary(/\.(step|stp)$/i.test(name) ? step(name) : stl(name));
    }
    if (p === `${API}/models/${SLUG}`) {
      return scenario === "missing" ? json({ error: "Not found" }, 404) : json(loadFixture("grabcad", "model"));
    }
    if (p === `${API}/models/${SLUG}/gallery`) return json(loadFixture("grabcad", "gallery"));
    if (p === `${API}/models/${SLUG}/files`) {
      const folder = folders[url.searchParams.get("folder_id") ?? "root"];
      return folder ? json(folder) : json({ error: "Not found" }, 404);
    }
    if (p === `${API}/models/${SLUG}/files/download`) {
      const name = byCadid.get(url.searchParams.get("cadid"));
      if (!signedIn) return json({ error: "You need to log in or sign up before continuing." }, 401);
      return json({
        url: `https://grabcad.com/cads/files/${url.searchParams.get("cadid")}/original.${name!.split(".").pop()}`,
      });
    }
    if (p.startsWith(`${API}/models/`)) return json({ error: "Not found" }, 404);
    if (p === `${API}/models` && method === "POST") return json(loadFixture("grabcad", "popular"));
    // A visitor's `/members/me` is answered with nothing at all.
    if (p === `${API}/members/me`)
      return signedIn ? json(loadFixture("grabcad", "me")) : new Response(null, { status: 204 });
    if (p === `/${MEMBER}/likes` && scenario !== "gone") {
      if (url.searchParams.get("page") !== "2") return html(loadFixtureHtml("grabcad", "likes"));
      if (scenario !== "gone-mid-read") return html(loadFixtureHtml("grabcad", "likes-2"));
    }
    if (/^\/[^/]+\/likes$/.test(p)) return html("<h1>Not found</h1>", 404);
    return undefined;
  };
}

const ACCOUNT = { member: MEMBER, name: "Maker One" };
const connect = (userId: string, account: typeof ACCOUNT | null = ACCOUNT) =>
  setUserGrabcadSession(userId, { session: SESSION }, account && { ...account });

const spec: ProviderContractSpec = {
  id: "grabcad",
  name: "GrabCAD",
  modelUrl: MODEL_URL,
  expected: {
    externalId: SLUG,
    title: "Arduino Uno R3",
    notesIncludes: "An Arduino Uno, Rev 3 in solidworks",
    author: "Andrew_Whitham",
    // As the library keeps them: title-cased.
    tags: ["Arduino", "Electronic", "Robotics", "Uno"],
    // Educational, Electrical and Tech: "Educational" says least of the three, so Electrical maps it.
    category: { name: "Electronics", parent: "Hobby & DIY" },
    galleryImages: 3,
    // Its STEP alone: the Parasolid, SOLIDWORKS and IGES files are no model files, and the SOLIDWORKS zip is only
    // fetched when nothing else brings one.
    plateInstanceIds: [null],
    plateFilenames: ["arduino uno.STEP"],
  },
  connect: (userId) => connect(userId),
  disconnect: async (userId) => {
    await setUserGrabcadSession(userId, null);
  },
  createHandler: (scenario) => handlerFor(scenario),
  credentials: {
    sessionCode: "grabcad_session",
    connection: async (userId) => (await getGrabcadConnection(userId)).state,
  },
  reimport: {},
  list: {
    endpoint: "/api/import/grabcad/list/entries",
    url: LIKES_URL,
    title: `GrabCAD likes (@${MEMBER})`,
    importedId: HUSKY,
    freshId: VISE,
  },
  // Anyone's likes are anyone's to read; a member who's gone is answered 404.
  listing: {
    sync: { externalId: `likes:${MEMBER}`, sourceUrl: LIKES_URL },
    ids: [HUSKY, GLASS, VISE],
    needsSignIn: false,
  },
};

const ctx = describeProviderContract(spec);

describe("GrabCAD specifics", () => {
  it("answers a model GrabCAD doesn't have with 404", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    expect((await ctx.importUrl("https://grabcad.com/library/nothing-here-1")).status).toBe(404);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("keeps the formats the model comes in, and asks for a file only with the user's sign-in", async () => {
    await connect(ctx.userId);
    const stub = ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    const [print] = await ctx.prints();
    expect(print.notes).toContain("## Model details");
    expect(print.notes).toContain("**Formats:** STEP / IGES, SOLIDWORKS, Parasolid");
    const downloads = stub.calls.filter((call) => call.url.pathname.endsWith("/files/download"));
    expect(downloads.map((call) => call.headers.cookie)).toEqual([`_grabcad_session=${SESSION}`]);
    // The file list is read without it, every folder of it.
    const lists = stub.calls.filter((call) => call.url.pathname.endsWith("/files"));
    expect(lists.map((call) => call.url.searchParams.get("folder_id"))).toEqual([null, String(RENDERINGS)]);
    expect(lists.every((call) => !call.headers.cookie)).toBe(true);
  });

  it("finds model files in the model's folders, and opens a CAD system's zip only when nothing else brought one", async () => {
    await connect(ctx.userId);
    const parts = {
      root: {
        files: [
          fileRow("frame.SLDPRT", "SOLIDWORKS", "1".repeat(32)),
          fileRow("frame.zip", "SOLIDWORKS", "2".repeat(32)),
        ],
        folders: [{ id: 7, name: "Print" }],
      },
      7: { files: [fileRow("frame.stl", "STL", "3".repeat(32))], folders: [] },
    };
    const stub = ctx.install(handlerFor("ok", { folders: parts, zips: { "frame.zip": { "frame.step": step("x") } } }));
    expectStatus(await ctx.importUrl(), 200);
    const [print] = await ctx.prints();
    const plates = await prisma.plate.findMany({ where: { printId: print.id } });
    expect(plates.map((plate) => plate.filename)).toEqual(["frame.stl"]);
    expect(stub.calls.filter((call) => call.url.pathname.startsWith("/cads/"))).toHaveLength(1);

    await prisma.print.deleteMany({ where: { userId: ctx.userId, sourceProvider: "grabcad" } });
    ctx.install(
      handlerFor("ok", {
        folders: { root: { files: parts.root.files, folders: [] } },
        zips: { "frame.zip": { "frame.step": step("x") } },
      }),
    );
    expectStatus(await ctx.importUrl(), 200);
    const [zipped] = await ctx.prints();
    const zipPlates = await prisma.plate.findMany({ where: { printId: zipped.id } });
    expect(zipPlates.map((plate) => plate.filename)).toEqual(["frame.step"]);
  });

  it("lists every page of someone's likes, without a sign-in", async () => {
    await setUserGrabcadSession(ctx.userId, null);
    ctx.stub("ok");
    const likes = await ctx.post(spec.list!.endpoint, { url: `${LIKES_URL}?page=2` });
    expectStatus(likes, 200);
    expect(likes.body.title).toBe(`GrabCAD likes (@${MEMBER})`);
    expect(likes.body.entries.map((entry: { design_id: string }) => entry.design_id)).toEqual([HUSKY, GLASS, VISE]);
    expect(likes.body.entries[1].title).toBe("Cabernet (tulip) wine glass");

    ctx.stub("ok");
    const nobody = await ctx.post(spec.list!.endpoint, { url: "https://grabcad.com/no.one-1/likes" });
    expect(nobody.status).toBe(404);
  });

  // A page past the last is answered empty, so a later one's 404 is no answer: not a shorter list.
  it("doesn't sync a member's likes short when one goes away while their pages are read", async () => {
    ctx.stub("gone-mid-read");
    await expect(fetchListing({ provider: "grabcad", userId: ctx.userId, ...spec.listing!.sync })).rejects.toThrow(
      "HTTP 404",
    );
  });

  it("shows the user's own likes in the Browse tab, by whom their sign-in says they are", async () => {
    // A sign-in kept without a check that said whose it is: the site is asked, and the answer kept.
    await connect(ctx.userId, null);
    const stub = ctx.stub("ok");
    const cards = await grabcadBrowse.cards(ctx.userId);
    expect(cards.map((card) => [card.id, card.name, card.modelCount, card.private, card.owner])).toEqual([
      [`likes:${MEMBER}`, `GrabCAD likes (@${MEMBER})`, 3, false, "Maker One"],
    ]);
    expect(cards[0].url).toBe(LIKES_URL);
    expect(stub.calls.filter((call) => call.url.pathname.endsWith("/members/me"))).toHaveLength(1);
    expect((await getGrabcadConnection(ctx.userId)).account).toEqual(ACCOUNT);

    await setUserGrabcadSession(ctx.userId, null);
    await expect(grabcadBrowse.cards(ctx.userId)).rejects.toMatchObject({ status: 409 });
  });

  it("lists the popular models of its 3D printing category with STL files", async () => {
    const stub = ctx.stub("ok");
    const trending = await grabcadTrending.fetch(ctx.userId, 2);
    expect(Array.isArray(trending) && trending.map((model) => [model.id, model.paid])).toEqual([
      ["wilga-draco-xl-rc-aircraft-inspired-by-mike-patey-s-legendary-design-1", false],
      ["all-terrain-robot-car-1", false],
    ]);
    expect(stub.calls[0].json).toMatchObject({ sort: "popular", categories: ["3d-printing"], softwares: ["stl"] });
  });

  it("keeps a pasted sign-in with whose it is, and turns one GrabCAD doesn't take down when asked to check", async () => {
    ctx.stub("ok");
    const pasted = `:authority\ngrabcad.com\ncookie\naws-waf-token=abc:def; _grabcad_session=${SESSION}; XSRF-TOKEN=x`;
    expect(await grabcadConnection.save(ctx.userId, { session: pasted, verify: true })).toEqual({ configured: true });
    expect(await getGrabcadConnection(ctx.userId)).toEqual({ state: "connected", account: ACCOUNT });
    const row = await prisma.providerConnection.findFirstOrThrow({
      where: { userId: ctx.userId, provider: "grabcad" },
    });
    expect(row.secret).toEqual({ session: SESSION });

    await expect(
      grabcadConnection.save(ctx.userId, { session: "ffffffffffffffffffffffffffffffff", verify: true }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(grabcadConnection.save(ctx.userId, { session: "not a cookie", verify: true })).rejects.toMatchObject({
      status: 422,
    });
  });
});

describe("GrabCAD pages", () => {
  it("reads a member's likes page: its models, its pages, how many the tab counts and whose they are", () => {
    const page = grabcadLikesFromPage(loadFixtureHtml("grabcad", "likes"), MEMBER);
    expect(page.entries.map((entry) => entry.slug)).toEqual([HUSKY, GLASS]);
    expect(page.entries[0].cover).toBe(
      "https://grabcad.com/screenshots/pics/251649e7efbc64b4562dd87cdb9c6e11/small.png",
    );
    expect(page.entries[0].likes).toBe(75);
    expect([page.pages, page.total, page.owner]).toEqual([2, 3, "Maker One"]);
  });

  it("puts a model's telling categories before the broad ones", () => {
    const categories = ["3d-printing", "educational", "robotics", "tools"].map((slug) => ({ cached_slug: slug }));
    expect(grabcadCategoryIds(categories)).toEqual(["robotics", "tools", "3d-printing", "educational"]);
  });

  it("takes each picture at its viewer's size, and the card's where that's a BMP", () => {
    const gallery = grabcadGalleryFrom(loadFixture("grabcad", "gallery"));
    expect(gallery?.map((image) => image.url.split("/").slice(-2).join("/"))).toEqual([
      "b3baed0511f56c9d2f2928a58f95c27c/large.jpg",
      "fbf86f56f27a52a4d7c659adca21775a/large.jpg",
      "835232ebc1b154c41bae5d241cfefddb/card.jpg",
    ]);
    expect(gallery?.[2].filename).toBe("arduino_Uno_Rev3-02 blue bottom.jpg");
  });

  it("picks what a plate takes and the zips of formats it opens, with OBJs and CAD systems' zips in reserve", () => {
    const kit = { isImportableFile: (name: string) => /\.(stl|3mf|step|stp|obj|scad)$/i.test(name) };
    const file = (name: string, system: string | null): GrabcadFile => ({ name, system, downloadUrl: name });
    const picks = grabcadFilePicks(
      [
        file("a.STEP", "STEP / IGES"),
        file("a.IGS", "STEP / IGES"),
        file("a.obj", "OBJ"),
        file("stl.zip", "STL"),
        file("asm.zip", "SOLIDWORKS"),
        file("a.SLDPRT", "SOLIDWORKS"),
        file("a.3mf", "3D Manufacturing Format"),
      ],
      kit,
    );
    expect(picks.first.map((f) => f.name)).toEqual(["a.STEP", "stl.zip", "a.3mf"]);
    expect(picks.fallback.map((f) => f.name)).toEqual(["a.obj", "asm.zip"]);
  });
});

describe("GrabCAD sign-in", () => {
  it("picks the session out of a Cookie header, or takes its bare value", () => {
    expect(normalizeGrabcadSession(`XSRF-TOKEN=abc; _grabcad_session=${SESSION}`)).toEqual({ session: SESSION });
    expect(normalizeGrabcadSession(` ${SESSION.toUpperCase()} `)).toEqual({ session: SESSION });
    expect(normalizeGrabcadSession("XSRF-TOKEN=abc")).toBeNull();
    expect(normalizeGrabcadSession("")).toBeNull();
    expect(normalizeGrabcadSession(null)).toBeNull();
  });
});
