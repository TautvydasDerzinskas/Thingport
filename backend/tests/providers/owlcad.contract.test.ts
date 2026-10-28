import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db";
import { listOwlcadExports, queueOwlcadExport } from "../../src/providers/owlcad/grabExports";
import { owlcadNeedsGrab } from "../../src/providers/owlcad/index";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import { assertThat, binary, expectStatus, json, loadFixture, ONE_PIXEL_PNG, type FetchHandler } from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// OwlCAD end to end. It needs no sign-in for anything: its gallery is a public Firestore collection, a library
// part's mesh a Firebase Storage object, and the one Cloud Function call it makes answers unauthenticated. The
// recorded answers in fixtures/providers/owlcad are the real shapes.
//
// The two halves of its gallery behave differently, and both are pinned here:
//   a library part    its stored GLB, converted to the STL OwlCAD itself would place on the plate;
//   a CAD project     no file anywhere -- its document is a script -- so the import is refused for Grab.

const PART_ID = "08ff2510-3f79-4169-8933-c0bf594f10e9";
const PROJECT_ID = "aeac7676-9243-49a2-8ebe-e8df226db6ed";
const PART_URL = `https://owlcad.com/gallery/${PART_ID}/oled-2-4-display`;
const PROJECT_URL = `https://owlcad.com/gallery/${PROJECT_ID}`;
const PART_PATH = `parts/${PART_ID}/model.glb`;

const partGlb = () => fs.readFileSync(path.join(__dirname, "../fixtures/providers/owlcad/part-model.glb"));

/** What Firestore really answers for a document that isn't there: its rules have nothing to grant a read on, so a
 *  model that is gone and one we may not read are the same 403. */
const missingDocument = () =>
  json({ error: { code: 403, message: "Missing or insufficient permissions.", status: "PERMISSION_DENIED" } }, 403);

function handlerFor(scenario: string): FetchHandler {
  return ({ url, method, body }) => {
    if (url.hostname === "firestore.googleapis.com") {
      // Deliberately keyless: its REST API answers without one, so none is ever sent.
      assertThat(!url.searchParams.has("key"), "the gallery is read without an API key");
      const id = url.pathname.split("/").pop();
      if (id === PART_ID && scenario !== "missing") return json(loadFixture("owlcad", "gallery-part"));
      if (id === PROJECT_ID) return json(loadFixture("owlcad", "gallery-project"));
      return missingDocument();
    }
    if (url.hostname === "firebasestorage.googleapis.com") {
      assertThat(method === "GET", "a part's mesh and picture are fetched plainly");
      if (url.pathname.includes(encodeURIComponent(PART_PATH))) return binary(partGlb());
      // Its one picture per item, the cover and the whole gallery at once.
      if (url.pathname.includes("thumb.png")) return binary(ONE_PIXEL_PNG, "image/png");
      return json({ error: {} }, 404);
    }
    if (url.hostname === "us-central1-webcad-66241.cloudfunctions.net") {
      assertThat(
        typeof body === "string" && body.includes("resolveProject"),
        "a CAD project's document is asked for by its own action",
      );
      // A document that is nothing but imported meshes, which would be ours to build -- except that resolveProject
      // gave no link for the one mesh it names, so there is nothing to fetch.
      if (scenario === "meshes-without-links") {
        return json({
          result: {
            name: "An imported mesh with no link",
            document: { nodes: [{ kind: "mesh", id: "n1", meshRef: "m1" }] },
            meshUrls: {},
          },
        });
      }
      return json(loadFixture("owlcad", "resolve-project"));
    }
    return undefined;
  };
}

const spec: ProviderContractSpec = {
  id: "owlcad",
  name: "OwlCAD",
  modelUrl: PART_URL,
  expected: {
    externalId: PART_ID,
    title: 'OLED 2.4" Display',
    // Its library parts carry no description at all -- not one of the 1,661 in its gallery has one.
    notesIncludes: "",
    description: false,
    author: "Adafruit Industries",
    tags: ["4in", "Display", "Electronics", "Oled"],
    category: { name: "Electronics", parent: "Hobby & DIY" },
    // Its gallery keeps one picture per item, which is already the cover.
    galleryImages: 1,
    plateInstanceIds: [null],
    plateFilenames: ["oled-2-4-display.stl"],
  },
  // Nothing to connect or forget: it keeps no credentials at all.
  connect: async () => undefined,
  disconnect: async () => undefined,
  createHandler: (scenario) => handlerFor(scenario),
  reimport: {},
  skip: {
    missingCredentials: "OwlCAD needs no sign-in: everything it serves answers without one.",
    rejectedCredentials: "It has no sign-in to turn down.",
    listAlreadyImported: "Its gallery is one list filtered by category, so there is no list to import.",
    fetchListing: "It has no collections or likes to sync.",
  },
};

const ctx = describeProviderContract(spec);

describe("OwlCAD specifics", () => {
  it("answers a model OwlCAD doesn't have with 404", async () => {
    ctx.stub("missing");
    expect((await ctx.importUrl()).status).toBe(404);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("places a library part as OwlCAD does: Z-up, its longest side 40 mm", async () => {
    ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    const [print] = await ctx.prints();
    const plate = await prisma.plate.findFirst({ where: { printId: print.id } });
    expect(plate?.filename).toBe("oled-2-4-display.stl");
    const stl = fs.readFileSync(path.join(process.env.FILE_STORAGE!, plate!.storagePath));
    const triangles = stl.readUInt32LE(80);
    // The site's own meshStats for this part: 552 triangles, 40 mm along its longest side.
    expect(triangles).toBe(552);
    const extent = (axis: number) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let t = 0; t < triangles; t++) {
        for (let corner = 0; corner < 3; corner++) {
          const v = stl.readFloatLE(84 + t * 50 + 12 + corner * 12 + axis * 4);
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
      return hi - lo;
    };
    const size = [extent(0), extent(1), extent(2)];
    const stated = (
      loadFixture<{ fields: Record<string, any> }>("owlcad", "gallery-part").fields.meshStats.mapValue.fields.sizeMm
        .arrayValue.values as { doubleValue?: number; integerValue?: string }[]
    ).map((v) => Number(v.doubleValue ?? v.integerValue));
    size.forEach((value, axis) => expect(value).toBeCloseTo(stated[axis], 1));
    expect(Math.max(...size)).toBeCloseTo(40, 5);
  });

  it("refuses a CAD project for Grab, since only OwlCAD's editor can build its file", async () => {
    const stub = ctx.stub("ok");
    const res = await ctx.importUrl(PROJECT_URL);
    expectStatus(res, 409);
    expect(res.body.code).toBe("owlcad_needs_grab");
    expect(await ctx.prints()).toHaveLength(0);
    // It asked the project's own action before giving up, and downloaded nothing.
    expect(stub.callsTo("us-central1-webcad-66241.cloudfunctions.net")).toHaveLength(1);
    expect(stub.callsTo("firebasestorage.googleapis.com")).toHaveLength(0);
  });

  it("imports a CAD project from the 3MF Grab exported, and clears what waited for it", async () => {
    ctx.stub("ok");
    await queueOwlcadExport(ctx.userId, PROJECT_URL);
    const listed = await listOwlcadExports(ctx.userId);
    expect(listed).toHaveLength(1);
    // Grab is told where to export it: the model open in OwlCAD's editor.
    expect(listed[0].editor_url).toBe(`https://owlcad.com/app?shared=${PROJECT_ID}`);

    const threeMf = fs.readFileSync(path.join(__dirname, "../fixtures/providers/owlcad/grab-export.3mf"));
    const res = await ctx.post(`/api/import/owlcad/waiting/${listed[0].id}`, {
      file: threeMf.toString("base64"),
    });
    expectStatus(res, 200);
    const [print] = await ctx.prints();
    expect(print.sourceExternalId).toBe(PROJECT_ID);
    expect(print.name).toBe("Gridfinity 2×3 bin");
    expect(await prisma.grabImport.findMany({ where: { userId: ctx.userId, provider: "owlcad" } })).toHaveLength(0);
  });

  it("sends a project whose meshes have no links to Grab, as the import does", async () => {
    ctx.stub("meshes-without-links");
    // The plan Grab asks for and the import itself have to answer alike. Saying no export was needed here would
    // leave the import refusing the model with 409 and the export never running at all.
    expect((await owlcadNeedsGrab(PROJECT_ID)).needsGrab).toBe(true);
    const res = await ctx.importUrl(PROJECT_URL);
    expectStatus(res, 409);
    expect(res.body.code).toBe("owlcad_needs_grab");
  });

  it("clears what waited for a model Grab exported on the page itself", async () => {
    ctx.stub("ok");
    await queueOwlcadExport(ctx.userId, PROJECT_URL);
    const threeMf = fs.readFileSync(path.join(__dirname, "../fixtures/providers/owlcad/grab-export.3mf"));
    const collection = await prisma.collection.create({
      data: { userId: ctx.userId, name: "Bins", nameNormalized: "bins" },
    });
    const res = await ctx.post("/api/import/owlcad/export", {
      url: PROJECT_URL,
      tags: [],
      collection_id: collection.id,
      file: threeMf.toString("base64"),
    });
    expectStatus(res, 200);
    // Nothing is left waiting: Grab's next visit would otherwise export this model a second time, for an import
    // that could only answer `already_imported`.
    expect(await prisma.grabImport.findMany({ where: { userId: ctx.userId, provider: "owlcad" } })).toHaveLength(0);
    // And it is filed where the import asked for it, as a waiting export's own collection is.
    const items = await prisma.collectionItem.findMany({ where: { collectionId: collection.id } });
    expect(items.map((item) => item.printId)).toEqual([res.body.id]);
  });

  it("takes an export larger than the global body limit", async () => {
    ctx.stub("ok");
    await queueOwlcadExport(ctx.userId, PROJECT_URL);
    const [waiting] = await listOwlcadExports(ctx.userId);
    // The file travels in the JSON itself, so the global parser's 100 kB would turn away every real export: a 3MF
    // of the 250k triangles OwlCAD's bridge allows is far past it. What the bytes then turn out to be is the
    // import's business -- the body reaching the route at all is this one's.
    const res = await ctx.post(`/api/import/owlcad/waiting/${waiting.id}`, { file: "A".repeat(400_000) });
    expect(res.status).not.toBe(413);
  });

  it("keeps its waiting exports apart from MakerOnline's", async () => {
    await queueOwlcadExport(ctx.userId, PROJECT_URL);
    await prisma.grabImport.create({
      data: { userId: ctx.userId, provider: "makeronline", url: "https://makeronline.com/model/4242" },
    });
    const { listGrabImports } = await import("../../src/providers/makeronline/grabImports");
    expect((await listOwlcadExports(ctx.userId)).map((row) => row.model_id)).toEqual([PROJECT_ID]);
    expect((await listGrabImports(ctx.userId)).map((row) => row.url)).toEqual(["https://makeronline.com/model/4242"]);
  });
});
