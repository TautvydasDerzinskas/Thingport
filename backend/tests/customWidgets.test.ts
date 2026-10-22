import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  blockingLookup,
  hostAllowed,
  metadataHost,
  parseManifest,
  setCustomWidgetsFetchForTest,
} from "../src/services/customWidgetsService";
import { setCustomWidgetsEnabled } from "../src/services/settingsService";
import { MCP_TOOLS } from "../src/mcp/tools";

const app = createApp();
const stamp = Date.now();
let token: string;
let userId: string;
const auth = () => ({ Authorization: `Bearer ${token}` });

const SCRIPT = "export default function mount({ root }) { root.textContent = 'hi'; }";
const METADATA = JSON.stringify({ name: "Hello", size: { w: 3, h: 2, minW: 2, minH: 2 }, hosts: ["api.example.com"] });

// The community repository, as GitHub would serve it.
const repo: Record<string, string> = {};
const respond = (body: string | undefined) =>
  new Response(body ?? "Not Found", { status: body === undefined ? 404 : 200 });

beforeAll(async () => {
  const registered = (
    await request(app)
      .post("/api/register")
      .send({ displayName: "Widgets", email: `custom-widgets-${stamp}@example.com`, password: "password123" })
  ).body;
  token = registered.token;
  userId = registered.user.id;
});

afterEach(async () => {
  setCustomWidgetsFetchForTest();
  await setCustomWidgetsEnabled(true);
});

afterAll(async () => {
  await prisma.customWidget.deleteMany({ where: { userId } });
});

describe("metadata", () => {
  it("reads JSON and YAML alike, filling in the defaults", () => {
    const yaml = parseManifest(
      "name: Clock\nsize: { w: 2, h: 2 }\nsettings:\n  - { key: tz, type: text, label: Zone }\n",
    );
    expect(yaml).toMatchObject({ name: "Clock", version: "1.0.0", hosts: [], settings: [{ key: "tz", type: "text" }] });
    expect(parseManifest(METADATA).hosts).toEqual(["api.example.com"]);
  });

  it("says what's wrong with bad metadata", () => {
    expect(() => parseManifest('{"size":{"w":2,"h":2,"minW":5}}')).toThrow(/name/);
    expect(() => parseManifest('{"name":"x","size":{"w":2,"h":2,"minW":5}}')).toThrow(/minimum size/);
    expect(() => parseManifest('{"name":"x","hosts":["https://a.com/path"]}')).toThrow(/host/);
  });

  it("lets a widget reach only the hosts it declares", () => {
    const hosts = ["api.example.com", "*.lan.example", "printer.local:8080"];
    expect(hostAllowed(new URL("https://api.example.com/v1"), hosts)).toBe(true);
    expect(hostAllowed(new URL("http://nas.lan.example/x"), hosts)).toBe(true);
    expect(hostAllowed(new URL("http://lan.example/x"), hosts)).toBe(false);
    expect(hostAllowed(new URL("http://printer.local:8080/"), hosts)).toBe(true);
    expect(hostAllowed(new URL("http://printer.local:9090/"), hosts)).toBe(false);
    expect(hostAllowed(new URL("https://evil.com/?api.example.com"), hosts)).toBe(false);
  });

  it("matches a wildcard host's port when it declares one", () => {
    const hosts = ["*.lan.example:8080"];
    expect(hostAllowed(new URL("http://nas.lan.example:8080/"), hosts)).toBe(true);
    expect(hostAllowed(new URL("http://nas.lan.example:9090/"), hosts)).toBe(false);
    expect(hostAllowed(new URL("http://nas.lan.example/"), hosts)).toBe(false);
  });

  it("tells cloud metadata addresses from the LAN", () => {
    expect(metadataHost("169.254.169.254")).toBe(true);
    expect(metadataHost("[fd00:ec2::254]")).toBe(true);
    expect(metadataHost("[::ffff:169.254.169.254]")).toBe(true);
    expect(metadataHost("metadata.google.internal")).toBe(true);
    expect(metadataHost("192.168.1.20")).toBe(false);
    expect(metadataHost("127.0.0.1")).toBe(false);
  });

  it("refuses a name that resolves to a metadata address when connecting", async () => {
    const resolvingTo = (address: string) =>
      blockingLookup(((_host: string, _options: unknown, callback: (...args: unknown[]) => void) =>
        callback(null, address, 4)) as never);
    const run = (lookup: ReturnType<typeof blockingLookup>) =>
      new Promise<NodeJS.ErrnoException | null>((resolve) => lookup("rebind.example", {}, (err) => resolve(err)));
    expect((await run(resolvingTo("169.254.169.254")))?.code).toBe("WIDGET_HOST_BLOCKED");
    expect(await run(resolvingTo("192.168.1.20"))).toBeNull();
  });
});

describe("own widgets", () => {
  it("saves, lists, replaces by slug and deletes", async () => {
    const saved = await request(app)
      .put("/api/widgets")
      .set(auth())
      .send({ slug: "hello", metadata: METADATA, script: SCRIPT });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ source: "own", slug: "hello", manifest: { name: "Hello" } });

    const again = await request(app)
      .put("/api/widgets")
      .set(auth())
      .send({ slug: "hello", metadata: METADATA.replace("Hello", "Hi"), script: SCRIPT });
    expect(again.body.id).toBe(saved.body.id);

    const list = await request(app).get("/api/widgets").set(auth());
    expect(list.body.enabled).toBe(true);
    expect(list.body.widgets.map((w: { manifest: { name: string } }) => w.manifest.name)).toContain("Hi");

    expect((await request(app).delete(`/api/widgets/${saved.body.id}`).set(auth())).status).toBe(204);
  });

  it("refuses a script without a default export, and a bad slug", async () => {
    const noExport = await request(app)
      .put("/api/widgets")
      .set(auth())
      .send({ slug: "broken", metadata: METADATA, script: "console.log(1)" });
    expect(noExport.status).toBe(400);
    const badSlug = await request(app)
      .put("/api/widgets")
      .set(auth())
      .send({ slug: "Not OK", metadata: METADATA, script: SCRIPT });
    expect(badSlug.status).toBe(400);
  });
});

describe("community widgets", () => {
  it("installs a snapshot, and offers the repository's change as an update", async () => {
    repo["index.json"] = JSON.stringify({ widgets: ["countdown"] });
    repo["countdown/widget.json"] = JSON.stringify({ name: "Countdown" });
    repo["countdown/widget.js"] = SCRIPT;
    setCustomWidgetsFetchForTest(async (input) => respond(repo[String(input).split("/community-widgets/")[1]]));

    const listed = await request(app).get("/api/widgets/community").set(auth());
    expect(listed.body.widgets).toMatchObject([{ slug: "countdown", installed: null }]);

    const installed = await request(app).post("/api/widgets/community/countdown/install").set(auth());
    expect(installed.body).toMatchObject({ source: "community", slug: "countdown", script: SCRIPT });

    // The repository changes; the installed copy doesn't, until the user takes the update.
    repo["countdown/widget.js"] = `${SCRIPT}\n// v2`;
    setCustomWidgetsFetchForTest(async (input) => respond(repo[String(input).split("/community-widgets/")[1]]));
    const changed = await request(app).get("/api/widgets/community").set(auth());
    expect(changed.body.widgets[0].installed).toMatchObject({ updateAvailable: true });
    const mine = await request(app).get("/api/widgets").set(auth());
    expect(mine.body.widgets.find((w: { slug: string }) => w.slug === "countdown").script).toBe(SCRIPT);

    await request(app).post("/api/widgets/community/countdown/install").set(auth());
    const updated = await request(app).get("/api/widgets/community").set(auth());
    expect(updated.body.widgets[0].installed).toMatchObject({ updateAvailable: false });
  });
});

describe("fetch through the server", () => {
  it("reaches a declared host and refuses any other", async () => {
    const saved = await request(app)
      .put("/api/widgets")
      .set(auth())
      .send({ slug: "fetcher", metadata: METADATA, script: SCRIPT });
    setCustomWidgetsFetchForTest(
      async () => new Response('{"ok":true}', { headers: { "content-type": "application/json" } }),
    );

    const ok = await request(app)
      .post(`/api/widgets/${saved.body.id}/fetch`)
      .set(auth())
      .send({ url: "https://api.example.com/status" });
    expect(ok.body).toEqual({ status: 200, contentType: "application/json", body: '{"ok":true}' });

    const refused = await request(app)
      .post(`/api/widgets/${saved.body.id}/fetch`)
      .set(auth())
      .send({ url: "http://169.254.169.254/latest/meta-data" });
    expect(refused.status).toBe(403);
  });

  it("refuses a cloud metadata address even when declared", async () => {
    const saved = await request(app)
      .put("/api/widgets")
      .set(auth())
      .send({
        slug: "metadata",
        metadata: JSON.stringify({ name: "Meta", hosts: ["169.254.169.254"] }),
        script: SCRIPT,
      });
    let called = false;
    setCustomWidgetsFetchForTest(async () => {
      called = true;
      return new Response("secret");
    });
    const refused = await request(app)
      .post(`/api/widgets/${saved.body.id}/fetch`)
      .set(auth())
      .send({ url: "http://169.254.169.254/latest/meta-data" });
    expect(refused.body.code).toBe("WIDGET_HOST_BLOCKED");
    expect(called).toBe(false);
  });

  it("connects to a declared host by name", async () => {
    const server = createServer((_req, res) => res.end("up"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const host = `localhost:${(server.address() as AddressInfo).port}`;
    try {
      const saved = await request(app)
        .put("/api/widgets")
        .set(auth())
        .send({ slug: "local", metadata: JSON.stringify({ name: "Local", hosts: [host] }), script: SCRIPT });
      const res = await request(app)
        .post(`/api/widgets/${saved.body.id}/fetch`)
        .set(auth())
        .send({ url: `http://${host}/` });
      expect(res.body).toMatchObject({ status: 200, body: "up" });
    } finally {
      server.close();
    }
  });

  it("takes a widget larger than the default body limit", async () => {
    const script = `${SCRIPT}\n// ${"x".repeat(300_000)}`;
    const saved = await request(app)
      .put("/api/widgets")
      .set(auth())
      .send({ slug: "large", metadata: METADATA, script });
    expect(saved.status).toBe(200);
  });
});

describe("admin switch", () => {
  it("empties the list and refuses saving while custom widgets are off", async () => {
    await setCustomWidgetsEnabled(false);
    expect((await request(app).get("/api/widgets").set(auth())).body).toEqual({ enabled: false, widgets: [] });
    const save = await request(app)
      .put("/api/widgets")
      .set(auth())
      .send({ slug: "x1", metadata: METADATA, script: SCRIPT });
    expect(save.status).toBe(403);
  });
});

describe("MCP", () => {
  it("saves a widget from an AI, with metadata as an object", async () => {
    const tool = MCP_TOOLS.find((t) => t.name === "save_widget")!;
    expect(tool.readOnly).toBe(false);
    const result = (await tool.run(
      { userId, publicUrl: "" },
      { slug: "from-ai", metadata: { name: "From AI" }, script: SCRIPT },
    )) as { name: string };
    expect(result.name).toBe("From AI");
    const guide = (await MCP_TOOLS.find((t) => t.name === "widget_guide")!.run({ userId, publicUrl: "" }, {})) as {
      guide: string;
    };
    expect(guide.guide).toContain("export default");
  });
});
