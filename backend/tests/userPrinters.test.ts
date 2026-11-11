import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { getMakerworldConnection, setUserMakerworldCookie } from "../src/providers/makerworld/session";

// The Bambu account is never asked: its answer stands in here.
const bound = vi.hoisted(() => ({ answer: null as unknown, calls: [] as string[] }));
vi.mock("../src/providers/makerworld/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/providers/makerworld/api")>();
  return {
    ...real,
    fetchBoundPrinters: async (token: string) => {
      bound.calls.push(token);
      return typeof bound.answer === "function" ? await (bound.answer as () => Promise<unknown>)() : bound.answer;
    },
  };
});

const app = createApp();
const stamp = Date.now();
let token: string;
let userId: string;
const printIds: string[] = [];

const auth = () => ({ Authorization: `Bearer ${token}` });
const mine = async () => (await request(app).get("/api/me/printers").set(auth())).body;
const put = (id: string, body: object = {}) => request(app).put(`/api/me/printers/${id}`).set(auth()).send(body);

beforeAll(async () => {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Printers", email: `printers-${stamp}@example.com`, password: "password123" });
  token = res.body.token;
  userId = res.body.user.id;
});

afterAll(async () => {
  await prisma.print.deleteMany({ where: { id: { in: printIds } } });
});

async function printWith(data: { sliced?: string; projects?: { printer: string; nozzle?: number }[] }) {
  const print = await prisma.print.create({
    data: {
      userId,
      name: `Printers ${printIds.length}`,
      nameNormalized: `printers ${printIds.length}`,
      ...(data.sliced ? { preparedMetadata: { printer: data.sliced } } : {}),
    },
  });
  printIds.push(print.id);
  for (const [position, project] of (data.projects ?? []).entries()) {
    await prisma.plate.create({
      data: {
        printId: print.id,
        position,
        filename: `p${position}.3mf`,
        mime: "model/3mf",
        storagePath: `printers-test/${print.id}/${position}.3mf`,
        format: { v: 1, kind: "bambu", printer: project.printer, nozzle: project.nozzle ?? 0.4 },
      },
    });
  }
}

describe("a user's printers", () => {
  it("start with none, and no Bambu account to look in", async () => {
    expect(await mine()).toEqual({ printers: [], suggestions: [], bambu: false });
  });

  it("are added from the catalogue with a nozzle it has, the nearest one if not", async () => {
    const res = await put("bambulab-p1s", { nozzle: "0.6" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ printer: { id: "bambulab-p1s", model: "P1S" }, nozzle: "0.6" });
    expect(res.body.presets).toMatchObject({ bambustudio: "Bambu Lab P1S 0.6 nozzle", prusaslicer: null });
    expect((await put("bambulab-p1s", { nozzle: "0.55" })).body.nozzle).toBe("0.6");
    // Added again without a nozzle: keeps the one it has.
    expect((await put("bambulab-p1s")).body.nozzle).toBe("0.6");
    expect((await mine()).printers.map((p: { printer: { id: string } }) => p.printer.id)).toEqual(["bambulab-p1s"]);
  });

  it("are only the catalogue's", async () => {
    expect((await put("no-such-printer")).status).toBe(404);
    expect((await put("Bambu%20Lab")).status).toBe(404);
    expect((await put("bambulab-a1", { nozzle: "x".repeat(20) })).status).toBe(400);
  });

  it("make a slicer that made copies for a removed printer ask again", async () => {
    await put("bambulab-a1mini");
    const slicer = (body: object) => request(app).patch("/api/settings/slicer").set(auth()).send(body);
    await slicer({ printer: { slicer: "orcaslicer", printer: "bambulab-a1mini" } });
    await slicer({ printer: { slicer: "bambustudio", printer: "bambulab-p1s" } });
    expect((await request(app).delete("/api/me/printers/bambulab-a1mini").set(auth())).status).toBe(204);
    const settings = (await request(app).get("/api/settings/slicer").set(auth())).body;
    expect(settings.printers).toEqual({ bambustudio: "bambulab-p1s" });
  });
});

describe("printer suggestions", () => {
  it("come from what the user's prints were sliced for, then from the printers their projects name", async () => {
    await printWith({ sliced: "Elegoo Centauri Carbon 0.4 nozzle" });
    await printWith({ projects: [{ printer: "Bambu Lab H2D 0.4 nozzle" }, { printer: "Bambu Lab H2D 0.4 nozzle" }] });
    // Once is a designer's printer, not enough to suggest; one already theirs isn't suggested.
    await printWith({
      projects: [{ printer: "Bambu Lab X1 Carbon 0.4 nozzle" }, { printer: "Bambu Lab P1S 0.4 nozzle" }],
    });
    const { suggestions } = await mine();
    expect(suggestions).toEqual([
      expect.objectContaining({
        printer: expect.objectContaining({ id: "elegoo-centauricarbon" }),
        sliced: 1,
        declined: false,
      }),
      expect.objectContaining({ printer: expect.objectContaining({ id: "bambulab-h2d" }), projects: 2, nozzle: "0.4" }),
    ]);
  });

  it("stay listed once turned down, as declined, until that's taken back", async () => {
    expect((await request(app).put("/api/me/printers/bambulab-h2d/declined").set(auth())).status).toBe(204);
    const declined = (await mine()).suggestions.find(
      (s: { printer: { id: string } }) => s.printer.id === "bambulab-h2d",
    );
    expect(declined.declined).toBe(true);
    await request(app).delete("/api/me/printers/bambulab-h2d/declined").set(auth());
    const back = (await mine()).suggestions.find((s: { printer: { id: string } }) => s.printer.id === "bambulab-h2d");
    expect(back.declined).toBe(false);
  });
});

describe("printers from the Bambu account", () => {
  let other: string;
  let otherId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Bambu", email: `printers-bambu-${stamp}@example.com`, password: "password123" });
    other = res.body.token;
    otherId = res.body.user.id;
  });

  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  it("are offered with a MakerWorld sign-in and no printers yet, and need one", async () => {
    expect((await request(app).post("/api/me/printers/bambu").set(as(other))).body.code).toBe("makerworld_signed_out");
    await setUserMakerworldCookie(otherId, "token=abc123");
    expect((await request(app).get("/api/me/printers").set(as(other))).body.bambu).toBe(true);
  });

  it("are added when asked, those the catalogue knows, and the offer goes", async () => {
    bound.answer = [
      { model: "C12", product: "P1S", nozzle: 0.4 },
      { model: "ZZ99", product: "Printer of the future", nozzle: 0.4 },
      { model: null, product: "A1 mini", nozzle: 0.2 },
    ];
    const res = await request(app).post("/api/me/printers/bambu").set(as(other));
    expect(res.status).toBe(200);
    expect(bound.calls.at(-1)).toBe("abc123");
    expect(res.body.printers.map((p: { printer: { id: string }; nozzle: string }) => [p.printer.id, p.nozzle])).toEqual(
      [
        ["bambulab-p1s", "0.4"],
        ["bambulab-a1mini", "0.2"],
      ],
    );
    expect((await request(app).get("/api/me/printers").set(as(other))).body.bambu).toBe(false);
  });

  it("say so when the sign-in has expired, and mark it so", async () => {
    bound.answer = "rejected";
    const res = await request(app).post("/api/me/printers/bambu").set(as(other));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("makerworld_rejected");
    expect(await getMakerworldConnection(otherId)).toBe("expired");
    bound.answer = null;
    await setUserMakerworldCookie(otherId, "token=abc123", { verified: true });
    expect((await request(app).post("/api/me/printers/bambu").set(as(other))).status).toBe(502);
  });

  it("don't mark a sign-in given while the old one was being turned down", async () => {
    bound.answer = async () => {
      await setUserMakerworldCookie(otherId, "token=newer456");
      return "rejected";
    };
    expect((await request(app).post("/api/me/printers/bambu").set(as(other))).status).toBe(409);
    expect(await getMakerworldConnection(otherId)).toBe("connected");
    bound.answer = null;
  });
});

describe("the printer catalogue", () => {
  it("lists every printer for Add printer, and serves their pictures without a sign-in", async () => {
    const res = await request(app).get("/api/printers/catalogue").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.printers.length).toBeGreaterThan(500);
    expect(res.body.brands.find((b: { id: string }) => b.id === "bambulab")).toBeTruthy();
    const withCover = res.body.printers.find((p: { cover?: boolean }) => p.cover);
    const cover = await request(app).get(`/api/printers/${withCover.id}/cover.webp`);
    expect(cover.status).toBe(200);
    expect(cover.headers["content-type"]).toBe("image/webp");
    expect((await request(app).get("/api/printers/catalogue")).status).toBe(401);
    expect((await request(app).get("/api/printers/..%2Fsecrets/cover.webp").set(auth())).status).toBe(404);
  });
});
