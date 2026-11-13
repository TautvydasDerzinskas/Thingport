import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import {
  ManyfoldImport,
  manyfoldLicense,
  manyfoldNotes,
  manyfoldTags,
  type ManyfoldOptions,
} from "../src/services/migrate/manyfold/import";
import { filePathOf, ManyfoldClient } from "../src/services/migrate/manyfold/api";
import { MIGRATE_FOLDER } from "../src/services/migrate/merge";

const app = createApp();
// Real enough for the import's pictures and plates: a 1x1 PNG, and a one-triangle STL.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
).toString("latin1");
const stl = (name: string) =>
  `solid ${name}\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid ${name}\n`;
const listen = (server: http.Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
const signedIn = (res: http.ServerResponse) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ access_token: "token-1", token_type: "Bearer", expires_in: 7200 }));
};

describe("reading Manyfold", () => {
  it("finds a file's folder in its link, as Manyfold 0.149 and newer give it", () => {
    expect(filePathOf("http://localhost:3214/models/abc/raw/parts/Base%20plate.stl")).toBe("parts/Base plate.stl");
    expect(filePathOf("http://localhost:3214/models/abc/raw/benchy.stl")).toBe("benchy.stl");
    expect(filePathOf("http://localhost:3214/models/abc/model_files/def.stl")).toBeNull();
  });

  it("maps licences, tags and notes into Thingport's", () => {
    expect(manyfoldLicense("CC-BY-4.0")?.id).toBe("CC-BY-4.0");
    expect(manyfoldLicense("LicenseRef-Commercial")).toMatchObject({ id: null, raw: "LicenseRef-Commercial" });
    expect(manyfoldLicense(undefined)).toBeNull();
    expect(manyfoldTags(["!new", "dragon", "Tabletop"])).toEqual(["Dragon", "Tabletop"]);
    expect(
      manyfoldNotes(
        {
          "@id": "m",
          caption: "A boat",
          description: "Prints well.",
          links: [{ url: "https://www.printables.com/model/1-x" }, { url: "https://example.com/more", text: "More" }],
        },
        "https://www.printables.com/model/1-x",
      ),
    ).toBe("*A boat*\n\nPrints well.\n\n- [More](https://example.com/more)");
  });

  it("follows a bucket's redirect on to the bucket's own next one, without the token", async () => {
    const tokens: (string | undefined)[] = [];
    const bucket = http.createServer((req, res) => {
      tokens.push(req.headers.authorization);
      if (req.url === "/files/item") res.writeHead(302, { Location: "actual.stl" }).end();
      else if (req.url === "/files/actual.stl") res.writeHead(200).end(stl("actual"));
      else res.writeHead(404).end();
    });
    const bucketAddress = await listen(bucket);
    const manyfold = http.createServer((req, res) => {
      if (req.url === "/oauth/token") return signedIn(res);
      if (req.url === "/models/m1/raw/a.stl")
        return res.writeHead(302, { Location: `${bucketAddress}/files/item` }).end();
      res.writeHead(404).end();
    });
    const address = await listen(manyfold);
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "manyfold-download-"));
    try {
      const client = new ManyfoldClient({ address, clientId: "app", clientSecret: "secret" });
      expect(await client.download(`${address}/models/m1/raw/a.stl`, path.join(folder, "a.stl"))).toBe(true);
      expect(await fs.readFile(path.join(folder, "a.stl"), "utf8")).toBe(stl("actual"));
      expect(tokens).toEqual([undefined, undefined]);
    } finally {
      bucket.close();
      manyfold.close();
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  it("leaves out a model whose id would name the folder above its own", async () => {
    // Something answering as Manyfold, for "/models/.." (which a request makes "/") as for any model.
    const hostile = http.createServer((req, res) => {
      if (req.url === "/oauth/token") return signedIn(res);
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/models?")) {
        return res.end(JSON.stringify({ totalItems: 1, member: [{ "@id": "/models/..", name: "Up" }] }));
      }
      res.end(JSON.stringify({ "@id": "/models/..", name: "Up" }));
    });
    const address = await listen(hostile);
    const runId = `manyfold-${crypto.randomBytes(4).toString("hex")}`;
    const kept = path.join(STORAGE, MIGRATE_FOLDER, `other-${runId}`, "kept.txt");
    await fs.mkdir(path.dirname(kept), { recursive: true });
    await fs.writeFile(kept, "another run's");
    try {
      const client = new ManyfoldClient({ address, clientId: "app", clientSecret: "secret" });
      const options = { owners: [], collections: false };
      const report = await new ManyfoldImport(client, runId, options, "admin", new Set(), () => undefined).run();
      expect(report.models).toMatchObject({ brought: 0, noFiles: 0, failed: 1 });
      expect(await fs.readFile(kept, "utf8")).toBe("another run's");
    } finally {
      hostile.close();
      await fs.rm(path.dirname(kept), { recursive: true, force: true });
    }
  });
});

type Model = {
  id: string;
  owner: string;
  name: string;
  files: { id: string; path: string; mime: string; body: string }[];
  collections?: string[];
  links?: { url: string; text?: string }[];
  keywords?: string[];
  license?: string;
  preview?: string;
};

const MODELS: Model[] = [
  {
    id: "dragon1",
    owner: "alex",
    name: "Red Dragon",
    files: [
      { id: "f1", path: "parts/body.stl", mime: "model/stl", body: stl("body") },
      { id: "f2", path: "wings.stl", mime: "model/stl", body: stl("wings") },
      { id: "f3", path: "images/side.png", mime: "image/png", body: PNG },
      { id: "f4", path: "images/front.png", mime: "image/png", body: PNG },
      { id: "f5", path: "guide.pdf", mime: "application/pdf", body: "pdf" },
    ],
    collections: ["dragons"],
    keywords: ["!new", "dragon"],
    license: "CC-BY-4.0",
    preview: "f4",
    links: [{ url: "https://example.com/dragon", text: "Designer's page" }],
  },
  {
    id: "gear2",
    owner: "alex",
    name: "Gear",
    files: [{ id: "g1", path: "gear.stl", mime: "model/stl", body: stl("gear") }],
  },
  {
    id: "boat3",
    owner: "sam",
    name: "Boat",
    files: [{ id: "b1", path: "boat.stl", mime: "model/stl", body: stl("boat") }],
    links: [{ url: "https://www.printables.com/model/555-boat" }],
  },
  {
    id: "pdf4",
    owner: "sam",
    name: "Only a manual",
    files: [{ id: "p1", path: "manual.pdf", mime: "application/pdf", body: "pdf" }],
  },
];

const COLLECTIONS: Record<string, { name: string; parent?: string }> = {
  minis: { name: "Minis" },
  dragons: { name: "Dragons", parent: "minis" },
};

/** Holds back the download of one model's files: the test answers it, or drops it. */
type Hold = { model: string | null; onHold?: (res: http.ServerResponse) => void };

/** Manyfold as its API answers, two models a page, with links on another hostname as its PUBLIC_HOSTNAME gives. */
function standIn(
  secret: string,
  {
    old = false,
    hold,
    signIns,
    models = MODELS,
    refuse,
  }: {
    old?: boolean;
    hold?: Hold;
    signIns?: { count: number };
    models?: Model[];
    /** Answers requests for paths it matches with this status, as long as `refuse.on` is set. */
    refuse?: { path: RegExp; status: number; on: boolean };
  } = {},
): Promise<http.Server> {
  const own = "http://localhost:3214";
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stand-in");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/oauth/token" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        const form = new URLSearchParams(body);
        if (form.get("client_secret") !== secret || form.get("grant_type") !== "client_credentials") {
          return json(401, { error: "invalid_client" });
        }
        if (signIns) signIns.count += 1;
        json(200, { access_token: "token-1", token_type: "Bearer", expires_in: 7200 });
      });
      return;
    }
    if (req.headers.authorization !== "Bearer token-1") return json(401, { error: "unauthorized" });
    if (refuse?.on && refuse.path.test(url.pathname)) return json(refuse.status, {});
    const page = Number(url.searchParams.get("page") ?? "1");
    const list = (items: { "@id": string; name: string }[]) => {
      const slice = items.slice((page - 1) * 2, page * 2);
      json(200, {
        totalItems: items.length,
        member: slice,
        view: page * 2 < items.length ? { next: `/models?page=${page + 1}` } : {},
      });
    };
    let match: RegExpExecArray | null;
    if (url.pathname === "/models") {
      const owner = url.searchParams.get("owner");
      if (owner && !models.some((model) => model.owner === owner)) return json(404, { error: "not found" });
      return list(
        models
          .filter((model) => !owner || model.owner === owner)
          .map((model) => ({
            "@id": `${own}/models/${model.id}`,
            name: model.name,
          })),
      );
    }
    if ((match = /^\/models\/([^/]+)$/.exec(url.pathname))) {
      const model = models.find((item) => item.id === match![1]);
      if (!model) return json(404, {});
      return json(200, {
        "@id": `${own}/models/${model.id}`,
        name: model.name,
        caption: `${model.name}, by its maker`,
        hasPart: model.files.map((file) => ({
          "@id": `${own}/models/${model.id}/model_files/${file.id}`,
          name: file.path,
          encodingFormat: file.mime,
        })),
        isPartOf: (model.collections ?? []).map((id) => ({ "@id": `${own}/collections/${id}` })),
        creator: { "@id": `${own}/creators/maker-one` },
        keywords: model.keywords ?? [],
        ...(model.license ? { "spdx:license": { licenseId: model.license } } : {}),
        ...(model.preview ? { preview_file: { "@id": `${own}/models/${model.id}/model_files/${model.preview}` } } : {}),
        links: model.links ?? [],
      });
    }
    if ((match = /^\/models\/([^/]+)\/model_files\/([^/]+)$/.exec(url.pathname))) {
      const model = models.find((item) => item.id === match![1]);
      const file = model?.files.find((item) => item.id === match![2]);
      if (!model || !file) return json(404, {});
      const contentUrl = old
        ? `${own}/models/${model.id}/model_files/${file.id}.stl`
        : `${own}/models/${model.id}/raw/${file.path.split("/").map(encodeURIComponent).join("/")}`;
      return json(200, {
        "@id": `${own}/models/${model.id}/model_files/${file.id}`,
        contentUrl,
        encodingFormat: file.mime,
      });
    }
    if ((match = /^\/models\/([^/]+)\/raw\/(.+)$/.exec(url.pathname))) {
      const model = models.find((item) => item.id === match![1]);
      const file = model?.files.find((item) => item.path === decodeURIComponent(match![2]));
      if (!file) return json(404, {});
      if (hold?.model && hold.model === model?.id) return hold.onHold?.(res);
      res.writeHead(200, { "Content-Type": file.mime });
      return res.end(Buffer.from(file.body, "latin1"));
    }
    if (url.pathname === "/collections") {
      return list(Object.entries(COLLECTIONS).map(([id, item]) => ({ "@id": `/collections/${id}`, name: item.name })));
    }
    if ((match = /^\/collections\/([^/]+)$/.exec(url.pathname))) {
      const item = COLLECTIONS[match[1]];
      if (!item) return json(404, {});
      return json(200, {
        "@id": `${own}/collections/${match[1]}`,
        name: item.name,
        ...(item.parent ? { isPartOf: { "@id": `${own}/collections/${item.parent}` } } : {}),
      });
    }
    if (url.pathname === "/creators") return list([{ "@id": "/creators/maker-one", name: "Maker One" }]);
    if (url.pathname === "/creators/maker-one")
      return json(200, { "@id": `${own}/creators/maker-one`, name: "Maker One" });
    json(404, {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

describe("migrating from Manyfold", () => {
  const tag = crypto.randomBytes(4).toString("hex");
  const secret = `secret-${tag}`;
  let server: http.Server;
  let oldServer: http.Server;
  let address = "";
  let adminToken = "";
  let adminId = "";
  let alexHere = "";
  const runs: string[] = [];
  const users: string[] = [];
  const signIns = { count: 0 };
  const auth = () => ({ Authorization: `Bearer ${adminToken}` });
  const until = async (id: string) => {
    for (let tries = 0; tries < 400; tries++) {
      const res = await request(app).get(`/api/admin/migrate/${id}`).set(auth());
      if (res.body.status === "done" || res.body.status === "failed") return res.body;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("it never finished");
  };
  const start = (id: string) =>
    request(app)
      .post(`/api/admin/migrate/${id}/start-manyfold`)
      .set(auth())
      .send({ owners: [{ username: "alex", userId: alexHere }], collections: true });

  beforeAll(async () => {
    server = await standIn(secret, { signIns });
    oldServer = await standIn(secret, { old: true });
    address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const email = `manyfold-admin-${tag}@example.com`;
    const registered = await request(app)
      .post("/api/register")
      .send({ displayName: "Manyfold Admin", email, password: "password123" });
    adminId = registered.body.user.id;
    await prisma.user.update({ where: { id: adminId }, data: { role: "ADMIN" } });
    adminToken = (await request(app).post("/api/login").send({ email, password: "password123" })).body.token;
    alexHere = (await prisma.user.create({ data: { email: `alex-${tag}@example.com`, displayName: "Alex Here" } })).id;
    // The admin imported Boat from Printables already.
    await prisma.print.create({
      data: {
        userId: adminId,
        name: "Boat",
        nameNormalized: "boat",
        sourceProvider: "printables",
        sourceExternalId: "555",
      },
    });
  });

  afterAll(async () => {
    server?.close();
    oldServer?.close();
    await prisma.user.deleteMany({ where: { id: { in: [adminId, alexHere, ...users] } } });
    await prisma.migrationRun.deleteMany({ where: { id: { in: runs } } });
  });

  it("says at once when the key is wrong, or Manyfold too old to say where its files are", async () => {
    const wrong = await request(app)
      .post("/api/admin/migrate/manyfold")
      .set(auth())
      .send({ address, clientId: "app", clientSecret: "nope" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe("manyfold_key");
    const old = await request(app)
      .post("/api/admin/migrate/manyfold")
      .set(auth())
      .send({
        address: `http://127.0.0.1:${(oldServer.address() as AddressInfo).port}`,
        clientId: "app",
        clientSecret: secret,
      });
    expect(old.body.code).toBe("manyfold_old");
  });

  it("brings each owner's models to the person picked, everyone else's to the admin, and nothing twice", async () => {
    const prepared = await request(app)
      .post("/api/admin/migrate/manyfold")
      .set(auth())
      .send({ address, clientId: "app", clientSecret: secret })
      .expect(200);
    runs.push(prepared.body.id);
    expect(prepared.body).toMatchObject({ source: "manyfold", status: "ready" });
    expect(prepared.body.plan.manyfold).toMatchObject({ models: 4, collections: 2, creators: 1, before: 0 });
    expect(JSON.stringify(prepared.body)).not.toContain(secret);

    const alex = await request(app)
      .post(`/api/admin/migrate/${prepared.body.id}/manyfold-owner`)
      .set(auth())
      .send({ username: "alex" });
    expect(alex.body).toEqual({ username: "alex", models: 2 });
    const nobody = await request(app)
      .post(`/api/admin/migrate/${prepared.body.id}/manyfold-owner`)
      .set(auth())
      .send({ username: "nobody" });
    expect(nobody.body.models).toBe(0);

    await start(prepared.body.id).expect(202);
    const done = await until(prepared.body.id);
    expect(done.error).toBeNull();
    expect(done.report.models).toMatchObject({ brought: 2, alreadyHere: 1, noFiles: 1, failed: 0 });

    // Alex's dragon, with its folder, pictures (its preview first), guide, tags, licence, creator and collection.
    const dragon = await prisma.print.findFirstOrThrow({
      where: { userId: alexHere, name: "Red Dragon" },
      include: {
        plates: { orderBy: { position: "asc" } },
        files: true,
        previewImages: { orderBy: { position: "asc" } },
      },
    });
    expect(dragon.plates.map((plate) => [plate.filename, plate.folder])).toEqual([
      ["body.stl", "parts"],
      ["wings.stl", null],
    ]);
    expect(dragon.files.map((file) => file.filename)).toContain("guide.pdf");
    expect(dragon.previewImages).toHaveLength(2);
    expect(dragon.tags).toEqual(["Dragon"]);
    expect(dragon.creator).toBe("Maker One");
    expect((dragon.license as { id?: string } | null)?.id).toBe("CC-BY-4.0");
    expect(dragon.notes).toContain("Red Dragon, by its maker");
    expect(dragon.notes).toContain("[Designer's page](https://example.com/dragon)");
    const collection = await prisma.collection.findFirstOrThrow({
      where: { userId: alexHere, name: "Minis / Dragons" },
      include: { items: true },
    });
    expect(collection.items.map((item) => item.printId)).toEqual([dragon.id]);
    expect(await prisma.print.count({ where: { userId: alexHere, name: "Gear" } })).toBe(1);
    // Sam isn't listed, so Sam's models went to the admin, whose Boat was there already.
    expect(await prisma.print.count({ where: { userId: adminId, name: "Boat" } })).toBe(1);
    // One sign-in for the check, the owners and the run: Manyfold allows a key only ten in three minutes.
    expect(signIns.count).toBe(1);
    // The key is gone; what came is kept.
    const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: prepared.body.id } });
    expect(run.remote).toEqual({ address, done: expect.arrayContaining(["dragon1", "gear2", "boat3"]) });

    // Again, as a new migration: everything came before.
    const again = await request(app)
      .post("/api/admin/migrate/manyfold")
      .set(auth())
      .send({ address, clientId: "app", clientSecret: secret })
      .expect(200);
    runs.push(again.body.id);
    expect(again.body.plan.manyfold.before).toBe(3);
    await start(again.body.id).expect(202);
    const second = await until(again.body.id);
    expect(second.report.models).toMatchObject({ brought: 0, earlier: 3, noFiles: 1 });
    expect(await prisma.print.count({ where: { userId: alexHere } })).toBe(2);
  });

  it("stops when Manyfold stops answering, keeping what came as it went, and goes on from there", async () => {
    const hold: Hold = { model: "gear2" };
    const flaky = await standIn(secret, { hold });
    const flakyAddress = `http://127.0.0.1:${(flaky.address() as AddressInfo).port}`;
    const alexAgain = (
      await prisma.user.create({ data: { email: `alex-again-${tag}@example.com`, displayName: "Alex Again" } })
    ).id;
    users.push(alexAgain);
    const options = { owners: [{ username: "alex", userId: alexAgain }], collections: false };
    try {
      const prepared = await request(app)
        .post("/api/admin/migrate/manyfold")
        .set(auth())
        .send({ address: flakyAddress, clientId: "app", clientSecret: secret })
        .expect(200);
      const id = prepared.body.id as string;
      runs.push(id);
      const held = new Promise<http.ServerResponse>((resolve) => (hold.onHold = resolve));
      await request(app).post(`/api/admin/migrate/${id}/start-manyfold`).set(auth()).send(options).expect(202);
      const response = await held;

      // Waiting on the gear's file, it has kept the dragon it brought already: a restart now wouldn't bring it twice.
      const running = await prisma.migrationRun.findUniqueOrThrow({ where: { id } });
      expect(running.status).toBe("running");
      expect((running.remote as { done?: string[] }).done).toEqual(["dragon1"]);

      // Manyfold goes away: the run stops there, rather than failing every model after.
      response.socket?.destroy();
      const stopped = await until(id);
      expect(stopped).toMatchObject({ status: "failed", can_resume: true, error: { code: "manyfold_lost" } });
      expect(stopped.report.models).toMatchObject({ brought: 1, failed: 0 });

      hold.model = null;
      await request(app).post(`/api/admin/migrate/${id}/start-manyfold`).set(auth()).send(options).expect(202);
      const done = await until(id);
      expect(done.status).toBe("done");
      expect(done.report.models).toMatchObject({ brought: 1, earlier: 1, alreadyHere: 1, noFiles: 1 });
      const names = await prisma.print.findMany({ where: { userId: alexAgain }, select: { name: true } });
      expect(names.map((print) => print.name).toSorted()).toEqual(["Gear", "Red Dragon"]);
    } finally {
      flaky.close();
    }
  });

  it("keeps each prepared print a model has, and brings again one whose collection failed", async () => {
    const models: Model[] = [
      {
        id: "printed5",
        owner: "kim",
        name: "Printed",
        files: [
          { id: "q1", path: "part.stl", mime: "model/stl", body: stl("part") },
          { id: "q2", path: "part.gcode", mime: "text/x-gcode", body: "G28\n" },
          { id: "q3", path: "part-fine.gcode", mime: "text/x-gcode", body: "G28\nG1 X1\n" },
        ],
      },
      {
        id: "boxed6",
        owner: "kim",
        name: "Boxed",
        files: [{ id: "x1", path: "box.stl", mime: "model/stl", body: stl("box") }],
        collections: ["minis"],
      },
    ];
    const kimServer = await standIn(secret, { models });
    const kim = (await prisma.user.create({ data: { email: `kim-${tag}@example.com`, displayName: "Kim" } })).id;
    users.push(kim);
    const options: ManyfoldOptions = { owners: [{ username: "kim", userId: kim }], collections: true };
    const done = new Set<string>();
    const importer = () =>
      new ManyfoldImport(
        new ManyfoldClient({
          address: `http://127.0.0.1:${(kimServer.address() as AddressInfo).port}`,
          clientId: "app",
          clientSecret: secret,
        }),
        `manyfold-${tag}-kim`,
        options,
        adminId,
        done,
        () => undefined,
      );
    try {
      // Its collection can't be made the first time: Boxed is left out whole, for the next run to bring.
      const create = vi.spyOn(prisma.collection, "create").mockRejectedValueOnce(new Error("The database went away"));
      try {
        expect((await importer().run()).models).toMatchObject({ brought: 1, failed: 1 });
      } finally {
        create.mockRestore();
      }
      expect(await prisma.print.count({ where: { userId: kim, name: "Boxed" } })).toBe(0);
      expect([...done]).toEqual(["printed5"]);

      // A model has one prepared print: the other is kept beside it rather than taking its place.
      const printed = await prisma.print.findFirstOrThrow({
        where: { userId: kim, name: "Printed" },
        include: { files: true },
      });
      expect(printed.files.map((file) => [file.filename, file.role]).toSorted()).toEqual([
        ["part-fine.gcode", "SUPPORTING"],
        ["part.gcode", "PREPARED"],
      ]);
      expect(printed.preparedFileId).toBe(printed.files.find((file) => file.filename === "part.gcode")?.id);

      expect((await importer().run()).models).toMatchObject({ brought: 1, earlier: 1, failed: 0 });
      const boxed = await prisma.print.findMany({ where: { userId: kim, name: "Boxed" }, select: { id: true } });
      expect(boxed).toHaveLength(1);
      const minis = await prisma.collection.findFirstOrThrow({ where: { userId: kim }, include: { items: true } });
      expect(minis.items.map((item) => item.printId)).toEqual([boxed[0].id]);
    } finally {
      kimServer.close();
    }
  });

  it("stops when asked to slow down, and doesn't make a model whose creator it couldn't read", async () => {
    const models: Model[] = [
      {
        id: "lamp7",
        owner: "lee",
        name: "Lamp",
        files: [{ id: "l1", path: "lamp.stl", mime: "model/stl", body: stl("lamp") }],
      },
    ];
    const refuse = { path: /^\/creators\//, status: 500, on: true };
    const leeServer = await standIn(secret, { models, refuse });
    const lee = (await prisma.user.create({ data: { email: `lee-${tag}@example.com`, displayName: "Lee" } })).id;
    users.push(lee);
    const importer = () =>
      new ManyfoldImport(
        new ManyfoldClient({
          address: `http://127.0.0.1:${(leeServer.address() as AddressInfo).port}`,
          clientId: "app",
          clientSecret: secret,
        }),
        `manyfold-${tag}-lee`,
        { owners: [{ username: "lee", userId: lee }], collections: false },
        adminId,
        new Set(),
        () => undefined,
      );
    try {
      // Its creator couldn't be read: it isn't made without, but left for the next run to bring whole.
      expect((await importer().run()).models).toMatchObject({ brought: 0, failed: 1 });
      expect(await prisma.print.count({ where: { userId: lee } })).toBe(0);
      // Asked to slow down, the run stops, rather than leave out every model after.
      Object.assign(refuse, { path: /^\/models\/lamp7$/, status: 429 });
      await expect(importer().run()).rejects.toMatchObject({ code: "manyfold_slow_down" });
      expect(await prisma.print.count({ where: { userId: lee } })).toBe(0);
      // A creator that's gone isn't one: the model comes without.
      Object.assign(refuse, { path: /^\/creators\//, status: 404 });
      expect((await importer().run()).models).toMatchObject({ brought: 1, failed: 0 });
      expect((await prisma.print.findFirstOrThrow({ where: { userId: lee } })).creator).toBeNull();
    } finally {
      leeServer.close();
    }
  });

  it("discards a model the server stopped part-way through, and brings it again whole", async () => {
    const models: Model[] = [
      {
        id: "vase8",
        owner: "rio",
        name: "Vase",
        files: [
          { id: "v1", path: "vase.stl", mime: "model/stl", body: stl("vase") },
          { id: "v2", path: "vase.png", mime: "image/png", body: PNG },
        ],
      },
    ];
    const rioServer = await standIn(secret, { models });
    const rioAddress = `http://127.0.0.1:${(rioServer.address() as AddressInfo).port}`;
    const [rio, rioAgain] = await Promise.all(
      ["rio", "rio-again"].map(
        async (name) =>
          (await prisma.user.create({ data: { email: `${name}-${tag}@example.com`, displayName: name } })).id,
      ),
    );
    users.push(rio, rioAgain);
    try {
      // The model it's making is kept as soon as it's made, until its files and pictures are all in.
      const halves: (string | null)[] = [];
      const job: ManyfoldImport = new ManyfoldImport(
        new ManyfoldClient({ address: rioAddress, clientId: "app", clientSecret: secret }),
        `manyfold-${tag}-rio`,
        { owners: [{ username: "rio", userId: rio }], collections: false },
        adminId,
        new Set(),
        () => undefined,
        async () => {
          halves.push(job.half);
        },
      );
      expect((await job.run()).models).toMatchObject({ brought: 1 });
      const vase = await prisma.print.findFirstOrThrow({ where: { userId: rio, name: "Vase" } });
      expect(halves).toEqual([vase.id, null]);

      // A run the server stopped while it made one: started again, it discards that one and brings it whole.
      const prepared = await request(app)
        .post("/api/admin/migrate/manyfold")
        .set(auth())
        .send({ address: rioAddress, clientId: "app", clientSecret: secret })
        .expect(200);
      const id = prepared.body.id as string;
      runs.push(id);
      const half = await prisma.print.create({ data: { userId: rioAgain, name: "Vase", nameNormalized: "vase" } });
      const kept = (await prisma.migrationRun.findUniqueOrThrow({ where: { id } })).remote as Prisma.JsonObject;
      await prisma.migrationRun.update({
        where: { id },
        data: { status: "failed", startedAt: new Date(), remote: { ...kept, half: half.id } },
      });
      await request(app)
        .post(`/api/admin/migrate/${id}/start-manyfold`)
        .set(auth())
        .send({ owners: [{ username: "rio", userId: rioAgain }], collections: false })
        .expect(202);
      expect((await until(id)).status).toBe("done");
      expect(await prisma.print.findUnique({ where: { id: half.id } })).toBeNull();
      const vases = await prisma.print.findMany({
        where: { userId: rioAgain },
        include: { plates: true, previewImages: true },
      });
      expect(vases.map((print) => [print.name, print.plates.length, print.previewImages.length])).toEqual([
        ["Vase", 1, 1],
      ]);
    } finally {
      rioServer.close();
    }
  });
});
