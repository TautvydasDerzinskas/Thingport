import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { templateProblem } from "../src/services/sendTargetFormat";
import { makeFileGrant, readFileGrant } from "../src/services/sendTargetService";

const app = createApp();
const stamp = Date.now();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const STL =
  "solid p\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid p\n";

type Person = { token: string; id: string };
type Received = { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer };
let owner: Person;
let other: Person;
let printId: string;
let plateId: string;
let server: http.Server;
let base: string;
const received: Received[] = [];
// What the stand-in answers, by path: OctoPrint's and PrusaLink's own, a webhook, and the ways one goes wrong.
const answers: Record<string, number> = {
  "/api/files/local": 201,
  "/api/version": 200,
  "/hook": 200,
  "/locked": 401,
  "/moved": 302,
};

async function register(name: string): Promise<Person> {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: name, email: `send-${name}-${stamp}@example.com`, password: "password123" });
  return { token: res.body.token as string, id: res.body.user.id as string };
}

const create = (person: Person, body: object) =>
  request(app).post("/api/me/send-targets").set(auth(person.token)).send(body);
const send = (person: Person, targetId: string, file = plateId, model = printId) =>
  request(app).post(`/api/print/${model}/send/${targetId}`).set(auth(person.token)).send({ file });
const last = () => received.at(-1)!;

beforeAll(async () => {
  owner = await register("owner");
  other = await register("other");
  const upload = await request(app)
    .post("/api/upload")
    .set(auth(owner.token))
    .attach("files", Buffer.from(STL), "corner bracket.gcode");
  printId = upload.body.prints[0].id;
  plateId = upload.body.prints[0].plates[0].id;
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const path = (req.url ?? "/").split("?")[0];
      received.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      const status = answers[path] ?? (path.startsWith("/api/v1/files/usb/") ? 201 : 404);
      if (status === 302) res.setHeader("Location", "http://example.com/");
      res.writeHead(status).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } });
});

describe("a destination's addresses", () => {
  it("fill values in only past the host, and never run script", () => {
    expect(templateProblem("https://studio.lan/?load={file_url}", true)).toBeNull();
    expect(templateProblem("myslicer://open?file={file_url}", false)).toBeNull();
    expect(templateProblem("myslicer://open?file={file_url}", true)).toMatch(/Only http/);
    expect(templateProblem("https://{model_name}.example.com/", true)).toMatch(/never in the scheme or the host/);
    expect(templateProblem("http://printer.lan:8080/upload", true)).toBeNull();
    // Read as the URL parser does, a missing, single or back slash or a tab still puts it in the host.
    for (const hidden of [
      "http:{model_name}/upload",
      "http:/{model_name}",
      "http:\\\\{model_name}",
      "http:/\t/{model_name}",
    ])
      expect(templateProblem(hidden, true)).toMatch(/never in the scheme or the host/);
    expect(templateProblem("https:{model_name}", false)).toMatch(/never in the scheme or the host/);
    expect(templateProblem("http://{model_name}@printer.lan/", true)).toMatch(/never in the scheme or the host/);
    expect(templateProblem("myslicer:{file_url}", false)).toBeNull();
    expect(templateProblem("http://printer.lan/{password}", true)).toMatch(/isn't a placeholder/);
    expect(templateProblem("javascript:alert({filename})", false)).toMatch(/can't use javascript:/);
    expect(templateProblem("data:text/html,hi", false)).toMatch(/can't use data:/);
  });
});

describe("a user's destinations", () => {
  it("keep an API key to themselves: kept, never sent back, kept on a save without it, and gone with null", async () => {
    const made = await create(owner, {
      name: "OctoPrint",
      how: { type: "preset", preset: "octoprint", address: `${base}/` },
      apiKey: "very-secret-key",
    });
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({
      name: "OctoPrint",
      placement: "menu",
      how: { type: "preset", preset: "octoprint", address: base, start: false },
      secrets: { api_key: true, headers: [] },
    });
    const listed = await request(app).get("/api/me/send-targets").set(auth(owner.token));
    expect(JSON.stringify(listed.body)).not.toContain("very-secret-key");

    const id = made.body.id as string;
    const resaved = await request(app)
      .put(`/api/me/send-targets/${id}`)
      .set(auth(owner.token))
      .send({ name: "OctoPi", placement: "button", how: { type: "preset", preset: "octoprint", address: base } });
    expect(resaved.body).toMatchObject({ name: "OctoPi", placement: "button", secrets: { api_key: true } });
    expect((await request(app).post(`/api/me/send-targets/${id}/test`).set(auth(owner.token))).body).toEqual({
      ok: true,
      status: 200,
    });
    expect(last()).toMatchObject({ method: "GET", url: "/api/version" });
    expect(last().headers["x-api-key"]).toBe("very-secret-key");

    // The model page gets them with the slicer settings it reads anyway.
    const slicer = await request(app).get("/api/settings/slicer").set(auth(owner.token));
    expect(slicer.body.send_targets).toEqual([
      {
        id,
        name: "OctoPi",
        kind: "preset",
        preset: "octoprint",
        placement: "button",
        file_types: [],
        open: null,
        tab: null,
      },
    ]);

    // Nobody else's to see, change or use.
    expect((await request(app).get("/api/me/send-targets").set(auth(other.token))).body.targets).toEqual([]);
    expect((await request(app).delete(`/api/me/send-targets/${id}`).set(auth(other.token))).status).toBe(404);
    expect((await send(other, id)).status).toBe(404);

    const cleared = await request(app)
      .put(`/api/me/send-targets/${id}`)
      .set(auth(owner.token))
      .send({ name: "OctoPi", how: { type: "preset", preset: "octoprint", address: base }, apiKey: null });
    expect(cleared.body.secrets.api_key).toBe(false);
    expect((await request(app).delete(`/api/me/send-targets/${id}`).set(auth(owner.token))).status).toBe(204);
  });

  it("export without a secret, and import what an export holds", async () => {
    await create(owner, {
      name: "Hook",
      how: {
        type: "request",
        url: `${base}/hook`,
        body: "json",
        headers: [
          { name: "Authorization", secret: true, value: "Bearer s3cret" },
          { name: "X-Plain", value: "shown" },
        ],
      },
    });
    const exported = await request(app).get("/api/me/send-targets/export").set(auth(owner.token));
    expect(exported.body).toMatchObject({ kind: "thingport-send-to", version: 1 });
    expect(JSON.stringify(exported.body)).not.toContain("s3cret");
    expect(exported.body.targets[0].how.headers).toEqual([
      { name: "Authorization", secret: true },
      { name: "X-Plain", secret: false, value: "shown" },
    ]);

    const imported = await request(app).post("/api/me/send-targets/import").set(auth(other.token)).send(exported.body);
    expect(imported.status).toBe(200);
    expect(imported.body.targets).toEqual([
      expect.objectContaining({ name: "Hook", secrets: { api_key: false, headers: [] } }),
    ]);
    // Only what it added comes back, so the panel adds it to the list it has.
    const again = await request(app).post("/api/me/send-targets/import").set(auth(other.token)).send(exported.body);
    expect(again.body.targets).toHaveLength(1);
    expect(again.body.targets[0].id).not.toBe(imported.body.targets[0].id);
    expect(await prisma.sendTarget.count({ where: { userId: other.id } })).toBe(2);
    expect(
      (await request(app).post("/api/me/send-targets/import").set(auth(other.token)).send({ targets: [] })).status,
    ).toBe(400);
    await prisma.sendTarget.deleteMany({ where: { userId: { in: [owner.id, other.id] } } });
  });

  it("test the settings being edited, with the saved key where none was typed", async () => {
    const saved = await create(owner, {
      name: "OctoPi",
      how: { type: "preset", preset: "octoprint", address: base },
      apiKey: "key-t",
    });
    const test = (url: string, body?: object) =>
      request(app)
        .post(url)
        .set(auth(owner.token))
        .send(body ?? {});
    const draft = (address: string) => ({ name: "OctoPi", how: { type: "preset", preset: "octoprint", address } });

    expect((await test(`/api/me/send-targets/${saved.body.id}/test`)).body).toEqual({ ok: true, status: 200 });
    // An address changed but not saved yet is the one tested, still with the kept key.
    expect((await test(`/api/me/send-targets/${saved.body.id}/test`, draft("http://127.0.0.1:9"))).body).toEqual({
      ok: false,
      reason: "unreachable",
    });
    expect((await test(`/api/me/send-targets/${saved.body.id}/test`, draft(base))).body).toEqual({
      ok: true,
      status: 200,
    });
    expect(last()).toMatchObject({ method: "GET", url: "/api/version" });
    expect(last().headers["x-api-key"]).toBe("key-t");

    // A new one is tested with the key typed in, and nothing is saved.
    const before = (await request(app).get("/api/me/send-targets").set(auth(owner.token))).body.targets.length;
    expect((await test("/api/me/send-targets/test", { ...draft(base), apiKey: "key-new" })).body.ok).toBe(true);
    expect(last().headers["x-api-key"]).toBe("key-new");
    expect((await request(app).get("/api/me/send-targets").set(auth(owner.token))).body.targets).toHaveLength(before);
    // Someone else's can't lend its key to a test.
    expect(
      (await request(app).post(`/api/me/send-targets/${saved.body.id}/test`).set(auth(other.token)).send(draft(base)))
        .status,
    ).toBe(404);
  });

  it("refuse what they couldn't send safely", async () => {
    const bad = (how: object) => create(owner, { name: "Bad", how });
    expect((await bad({ type: "request", url: "https://{model_name}.evil/" })).status).toBe(400);
    expect((await bad({ type: "request", url: "http:{model_name}/upload" })).status).toBe(400);
    expect((await bad({ type: "link", url: "javascript:alert(1)" })).status).toBe(400);
    expect((await bad({ type: "request", url: `${base}/x`, headers: [{ name: "Cookie", value: "a" }] })).status).toBe(
      400,
    );
    expect((await bad({ type: "preset", preset: "octoprint", address: "ftp://printer.lan" })).status).toBe(400);
  });
});

describe("sending a model's file", () => {
  it("uploads to OctoPrint as a form with the file, and asks it to print", async () => {
    const target = await create(owner, {
      name: "OctoPrint",
      how: { type: "preset", preset: "octoprint", address: base, start: true },
      apiKey: "key-1",
    });
    const sent = await send(owner, target.body.id);
    expect(sent.body).toEqual({ ok: true, status: 201, then_open: base });
    const req = last();
    expect(req).toMatchObject({ method: "POST", url: "/api/files/local" });
    expect(req.headers["x-api-key"]).toBe("key-1");
    expect(req.headers["content-type"]).toMatch(/^multipart\/form-data/);
    const body = req.body.toString("utf8");
    expect(body).toContain('name="file"; filename="corner bracket.gcode"');
    expect(body).toContain(STL);
    expect(body).toMatch(/name="select"\r\n\r\ntrue/);
    expect(body).toMatch(/name="print"\r\n\r\ntrue/);
  });

  it("puts the file itself to PrusaLink, its name in the address", async () => {
    const target = await create(owner, {
      name: "MK4",
      fileTypes: ["gcode"],
      how: { type: "preset", preset: "prusalink", address: base },
      apiKey: "key-2",
    });
    expect((await send(owner, target.body.id)).body).toMatchObject({ ok: true, status: 201 });
    const req = last();
    expect(req).toMatchObject({ method: "PUT", url: "/api/v1/files/usb/corner%20bracket.gcode" });
    expect(req.body.toString("utf8")).toBe(STL);
    expect(req.headers).toMatchObject({ "x-api-key": "key-2", overwrite: "?1" });
    expect(req.headers["print-after-upload"]).toBeUndefined();
  });

  it("hands a webhook a link to just that file, for an hour, that needs no sign-in", async () => {
    const target = await create(owner, {
      name: "n8n",
      how: {
        type: "request",
        url: `${base}/hook`,
        body: "json",
        headers: [{ name: "Authorization", secret: true, value: "Bearer h" }],
      },
    });
    expect((await send(owner, target.body.id)).body).toEqual({ ok: true, status: 200 });
    const req = last();
    expect(req.headers.authorization).toBe("Bearer h");
    const payload = JSON.parse(req.body.toString("utf8"));
    expect(payload).toMatchObject({
      event: "thingport.send",
      filename: "corner bracket.gcode",
      file_kind: "plate",
      plate_id: plateId,
      model: { id: printId },
      sent_by: "owner",
    });
    const link = new URL(payload.file_url);
    expect(link.pathname).toMatch(/^\/api\/send-file\/[^/]+\/corner%20bracket\.gcode$/);
    const file = await request(app).get(link.pathname);
    expect(file.status).toBe(200);
    expect(file.headers["cache-control"]).toBe("private, no-store");
    expect(Buffer.from(file.body as Buffer).toString("utf8") || file.text).toBe(STL);

    // Tampered with, expired, or used as a session, it opens nothing.
    const grant = link.pathname.split("/")[3];
    expect((await request(app).get(`/api/send-file/${grant}x/f.gcode`)).status).toBe(404);
    const old = makeFileGrant(owner.id, printId, plateId, Date.now() - 2 * 60 * 60 * 1000);
    expect(readFileGrant(old)).toBeNull();
    expect((await request(app).get(`/api/send-file/${old}/f.gcode`)).status).toBe(404);
    expect((await request(app).get("/api/me/send-targets").set(auth(grant))).status).toBe(401);
  });

  it("fills the file's link into a form field that asks for it", async () => {
    const target = await create(owner, {
      name: "Form",
      how: { type: "request", url: `${base}/hook`, fields: [{ name: "link", value: "{file_url}" }] },
    });
    expect((await send(owner, target.body.id)).body).toEqual({ ok: true, status: 200 });
    expect(last().body.toString("utf8")).toMatch(
      /name="link"\r\n\r\nhttp:\/\/[^\r]+\/api\/send-file\/[^/]+\/corner%20bracket\.gcode\r\n/,
    );
  });

  it("links to the prepared print it was sent, never to one that replaced it", async () => {
    const plate = await prisma.plate.findUniqueOrThrow({ where: { id: plateId } });
    // The model goes back to having no prepared print, as the tests after this one expect.
    onTestFinished(() =>
      prisma.print.update({ where: { id: printId }, data: { preparedFileId: null } }).then(() => {}),
    );
    const prepared = async (filename: string) => {
      const storagePath = join(dirname(plate.storagePath), filename);
      fs.writeFileSync(join(STORAGE, storagePath), filename);
      const record = await prisma.printFile.create({
        data: { printId, role: "PREPARED", filename, mime: "application/octet-stream", storagePath },
      });
      await prisma.print.update({ where: { id: printId }, data: { preparedFileId: record.id } });
    };
    await prepared("first.gcode.3mf");
    const target = await create(owner, { name: "Hook", how: { type: "request", url: `${base}/hook`, body: "json" } });
    expect((await send(owner, target.body.id, "prepared")).body).toEqual({ ok: true, status: 200 });
    const link = new URL(JSON.parse(last().body.toString("utf8")).file_url).pathname;
    const first = await request(app).get(link);
    expect(first.status).toBe(200);
    expect(Buffer.from(first.body as Buffer).toString("utf8") || first.text).toBe("first.gcode.3mf");

    await prepared("second.gcode.3mf");
    expect((await request(app).get(link)).status).toBe(404);
  });

  it("fills a link in for the browser to open", async () => {
    const target = await create(owner, {
      name: "Web slicer",
      how: { type: "link", url: "https://studio.lan/?load={file_url}&name={filename}", open: "named", tab: "slicer" },
    });
    const sent = await send(owner, target.body.id);
    expect(sent.body.open).toMatchObject({ mode: "named", tab: "slicer" });
    const url = new URL(sent.body.open.url);
    expect(url.origin).toBe("https://studio.lan");
    expect(url.searchParams.get("name")).toBe("corner bracket.gcode");
    expect(url.searchParams.get("load")).toMatch(/\/api\/send-file\//);
  });

  it("says why when it doesn't go, and goes nowhere it shouldn't", async () => {
    const at = async (url: string) =>
      (await send(owner, (await create(owner, { name: "T", how: { type: "request", url, body: "json" } })).body.id))
        .body;
    expect(await at(`${base}/locked`)).toEqual({ ok: false, reason: "auth", status: 401 });
    // A redirect isn't followed: it could lead anywhere.
    expect(await at(`${base}/moved`)).toEqual({ ok: false, reason: "redirect", status: 302 });
    expect(await at("http://127.0.0.1:9/hook")).toEqual({ ok: false, reason: "unreachable" });
    expect(await at("http://169.254.169.254/latest/meta-data")).toEqual({ ok: false, reason: "blocked" });

    const fussy = await create(owner, {
      name: "STL only",
      fileTypes: ["stl"],
      how: { type: "request", url: `${base}/hook` },
    });
    expect((await send(owner, fussy.body.id)).status).toBe(400);
    expect((await send(owner, fussy.body.id, "prepared")).status).toBe(404);
  });
});
