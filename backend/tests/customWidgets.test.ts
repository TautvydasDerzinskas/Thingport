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
  widgetsInUse,
} from "../src/services/customWidgetsService";
import { setWidgetSources } from "../src/services/settingsService";
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
  // Installed as if already done, so listing doesn't reach for GitHub; the samples' own test turns it back.
  await prisma.user.update({ where: { id: userId }, data: { sampleWidgetsAdded: true } });
});

afterEach(async () => {
  setCustomWidgetsFetchForTest();
  await setWidgetSources({ own: true, community: true });
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
    expect(list.body.sources).toEqual({ own: true, community: true });
    expect(list.body.widgets.map((w: { manifest: { name: string } }) => w.manifest.name)).toContain("Hi");

    expect((await request(app).delete(`/api/widgets/${saved.body.id}`).set(auth())).status).toBe(204);
  });

  it("credits the user when the metadata names no author, and keeps an author it names", async () => {
    const save = (metadata: object) =>
      request(app)
        .put("/api/widgets")
        .set(auth())
        .send({ slug: "credited", metadata: JSON.stringify(metadata), script: SCRIPT });
    expect((await save({ name: "Credited" })).body.manifest.author).toBe("Widgets");
    const named = await save({
      name: "Credited",
      author: "Jane Doe",
      authorUrl: "https://github.com/jane",
      iconUrl: "https://example.com/icon.svg",
    });
    expect(named.body.manifest).toMatchObject({
      author: "Jane Doe",
      authorUrl: "https://github.com/jane",
      iconUrl: "https://example.com/icon.svg",
    });
  });

  it("takes only http and https addresses for the icon and the author's page", async () => {
    const save = (metadata: object) =>
      request(app)
        .put("/api/widgets")
        .set(auth())
        .send({ slug: "addresses", metadata: JSON.stringify({ name: "Addresses", ...metadata }), script: SCRIPT });
    expect((await save({ iconUrl: "javascript:alert(1)" })).status).toBe(400);
    expect((await save({ authorUrl: "ftp://example.com" })).status).toBe(400);
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

  it("lists who installed a community widget, and who has it on a dashboard", async () => {
    repo["index.json"] = JSON.stringify({ widgets: ["countdown"] });
    repo["countdown/widget.json"] = JSON.stringify({ name: "Countdown" });
    repo["countdown/widget.js"] = SCRIPT;
    setCustomWidgetsFetchForTest(async (input) => respond(repo[String(input).split("/community-widgets/")[1]]));
    const installed = await request(app).post("/api/widgets/community/countdown/install").set(auth());
    await prisma.user.update({
      where: { id: userId },
      data: { dashboardTemplates: { panels: [`custom-${installed.body.id}:a1`] } },
    });

    const countdown = (await widgetsInUse()).find((w) => w.source === "community" && w.slug === "countdown");
    expect(countdown?.users).toContainEqual(expect.objectContaining({ id: userId, placed: true }));
  });
});

describe("sample widgets", () => {
  const listed = async () =>
    (
      (await request(app).get("/api/widgets").set(auth())).body.widgets as {
        id: string;
        source: string;
        slug: string;
      }[]
    ).filter((w) => w.source === "community" && w.slug === "countdown");

  it("installs the countdown once, and leaves it removed once the user removes it", async () => {
    repo["index.json"] = JSON.stringify({ widgets: ["countdown"] });
    repo["countdown/widget.json"] = JSON.stringify({ name: "Countdown", iconUrl: "builtin:thingport/hourglass" });
    repo["countdown/widget.js"] = SCRIPT;
    setCustomWidgetsFetchForTest(async (input) => respond(repo[String(input).split("/community-widgets/")[1]]));
    await prisma.customWidget.deleteMany({ where: { userId, source: "community", slug: "countdown" } });
    await prisma.user.update({ where: { id: userId }, data: { sampleWidgetsAdded: false } });

    const [sample] = await listed();
    expect(sample).toMatchObject({ manifest: { iconUrl: "builtin:thingport/hourglass" } });
    expect((await request(app).delete(`/api/widgets/${sample.id}`).set(auth())).status).toBe(204);
    expect(await listed()).toEqual([]);
  });

  it("tries again next time when the repository can't be reached", async () => {
    setCustomWidgetsFetchForTest(async () => respond(undefined));
    await prisma.user.update({ where: { id: userId }, data: { sampleWidgetsAdded: false } });
    expect((await request(app).get("/api/widgets").set(auth())).status).toBe(200);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { sampleWidgetsAdded: true } });
    expect(user?.sampleWidgetsAdded).toBe(false);
    await prisma.user.update({ where: { id: userId }, data: { sampleWidgetsAdded: true } });
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

describe("admin switches", () => {
  it("leaves users' own widgets out and refuses saving while they're off", async () => {
    await request(app).put("/api/widgets").set(auth()).send({ slug: "kept", metadata: METADATA, script: SCRIPT });
    await setWidgetSources({ own: false });
    const list = await request(app).get("/api/widgets").set(auth());
    expect(list.body.sources).toEqual({ own: false, community: true });
    expect(list.body.widgets.some((w: { source: string }) => w.source === "own")).toBe(false);
    const save = await request(app)
      .put("/api/widgets")
      .set(auth())
      .send({ slug: "x1", metadata: METADATA, script: SCRIPT });
    expect(save.status).toBe(403);
    expect(save.body.code).toBe("USER_WIDGETS_OFF");
  });

  it("refuses browsing and installing community widgets while they're off", async () => {
    await setWidgetSources({ community: false });
    const browse = await request(app).get("/api/widgets/community").set(auth());
    expect(browse.status).toBe(403);
    expect(browse.body.code).toBe("COMMUNITY_WIDGETS_OFF");
    expect((await request(app).post("/api/widgets/community/countdown/install").set(auth())).status).toBe(403);
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
