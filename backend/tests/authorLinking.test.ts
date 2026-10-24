import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// No pacing in tests. config.ts reads this on load, so it's hoisted.
vi.hoisted(() => {
  process.env.IMPORT_MAKERWORLD_CALL_DELAY_MS = "0";
  process.env.IMPORT_COLLECTION_DELAY_MS = "0";
});

import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { linkUnattributedPrints, upsertAuthorFromImport } from "../src/services/authorService";
import { runAuthorLinking, type AuthorLinkingRun } from "../src/services/authorLinkingService";
import { getThingiverseAccessToken, setThingiverseAccessToken } from "../src/providers/thingiverse/token";
import type { ImportedAuthorInfo } from "../src/services/importResolvers";

// Name-only models link to an author record, but only when the match is unambiguous.

const app = createApp();
const stamp = Date.now();
let userId: string;
let memberToken: string;
let adminToken: string;

beforeAll(async () => {
  const res = await request(app)
    .post("/api/register")
    .send({
      displayName: "Author Linking Test",
      email: `author-linking-${stamp}@example.com`,
      password: "password123",
    });
  userId = res.body.user.id;
  memberToken = res.body.token;
  const admin = await request(app)
    .post("/api/register")
    .send({
      displayName: "Author Linking Admin",
      email: `author-linking-admin-${stamp}@example.com`,
      password: "password123",
    });
  await prisma.user.update({ where: { id: admin.body.user.id }, data: { role: "ADMIN" } });
  adminToken = (
    await request(app)
      .post("/api/login")
      .send({ email: `author-linking-admin-${stamp}@example.com`, password: "password123" })
  ).body.token;
});

async function unattributedPrint(label: string, provider: string, creator: string | null) {
  const name = `${label} ${stamp}`;
  return prisma.print.create({
    data: {
      userId,
      name,
      nameNormalized: name.toLowerCase(),
      creator,
      sourceProvider: provider,
      sourceExternalId: `${label}-${stamp}`,
    },
  });
}

function authorInfo(
  provider: string,
  externalId: string,
  name: string | null,
  handle: string | null = null,
): ImportedAuthorInfo {
  return {
    provider,
    externalId: `${externalId}-${stamp}`,
    name,
    handle,
    bio: null,
    bioTranslated: null,
    links: [],
    avatarUrl: null,
    backgroundUrl: null,
  };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const authorOf = async (printId: string) => (await prisma.print.findUniqueOrThrow({ where: { id: printId } })).authorId;

describe("linking earlier imports to their author", () => {
  it("links a model once its author is imported, matching the name regardless of case", async () => {
    const print = await unattributedPrint("case", "makerworld", `mclanesmemories${stamp}`);
    const author = await upsertAuthorFromImport(authorInfo("makerworld", "case", `McLanesMemories${stamp}`));
    expect(await authorOf(print.id)).toBe(author!.id);
  });

  it("matches the handle too, with or without a leading @", async () => {
    const print = await unattributedPrint("handle", "printables", `@maker_${stamp}`);
    const author = await upsertAuthorFromImport(authorInfo("printables", "handle", "Display Name", `maker_${stamp}`));
    expect(await authorOf(print.id)).toBe(author!.id);
  });

  it("never links across providers", async () => {
    const print = await unattributedPrint("provider", "thingiverse", `SameName${stamp}`);
    await upsertAuthorFromImport(authorInfo("makerworld", "provider", `SameName${stamp}`));
    expect(await authorOf(print.id)).toBeNull();
  });

  it("leaves a name two known authors share alone rather than guessing", async () => {
    await upsertAuthorFromImport(authorInfo("makerworld", "twin-a", `Twin${stamp}`));
    await upsertAuthorFromImport(authorInfo("makerworld", "twin-b", `twin${stamp}`));
    const print = await unattributedPrint("ambiguous", "makerworld", `Twin${stamp}`);
    await linkUnattributedPrints();
    expect(await authorOf(print.id)).toBeNull();
  });

  it("doesn't touch a model already linked to someone, or one whose author was reset", async () => {
    const other = await upsertAuthorFromImport(authorInfo("makerworld", "other", `Someone Else ${stamp}`));
    const linked = await unattributedPrint("linked", "makerworld", `Taken${stamp}`);
    await prisma.print.update({ where: { id: linked.id }, data: { authorId: other!.id } });
    const reset = await unattributedPrint("reset", "makerworld", null);
    await upsertAuthorFromImport(authorInfo("makerworld", "taken", `Taken${stamp}`));
    expect(await authorOf(linked.id)).toBe(other!.id);
    expect(await authorOf(reset.id)).toBeNull();
  });

  it("links every model an existing author matches when run for all", async () => {
    const author = await prisma.author.create({
      data: {
        id: `makerworld:startup-${stamp}`,
        provider: "makerworld",
        externalId: `startup-${stamp}`,
        name: `Startup Author ${stamp}`,
      },
    });
    const print = await unattributedPrint("startup", "makerworld", `Startup Author ${stamp}`);
    expect(await linkUnattributedPrints()).toBeGreaterThanOrEqual(1);
    expect(await authorOf(print.id)).toBe(author.id);
  });
});

const originalFetch = global.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Answers the listed URLs (by prefix); anything else gets a 404. */
function mockFetch(routes: Record<string, () => Response>) {
  global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    const url = String(input);
    const match = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    return match ? routes[match]() : new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

function newRun(): AuthorLinkingRun {
  return {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    toLookUp: 0,
    lookedUp: 0,
    linked: 0,
    notFound: 0,
    problems: [],
  };
}

describe("looking up authors no known author matches", () => {
  let previousThingiverseToken: string | null;

  beforeAll(async () => {
    previousThingiverseToken = await getThingiverseAccessToken();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(async () => {
    await setThingiverseAccessToken(previousThingiverseToken);
  });

  it("fetches a Printables model's author once, linking every model of that creator", async () => {
    const modelId = String(stamp % 1_000_000_000);
    const creator = `PrintablesPerson${stamp}`;
    const first = await unattributedPrint("lookup-p1", "printables", creator);
    const second = await prisma.print.update({
      where: { id: (await unattributedPrint("lookup-p2", "printables", creator)).id },
      data: { sourceExternalId: `other-${stamp}` },
    });
    await prisma.print.update({
      where: { id: first.id },
      data: { sourceExternalId: modelId, createdAt: new Date(Date.now() + 60_000) },
    });
    let modelQueries = 0;
    mockFetch({
      "https://api.printables.com/graphql/": () => {
        modelQueries++;
        return json({
          data: {
            print: {
              id: modelId,
              name: "Anything",
              user: {
                id: `p-${stamp}`,
                handle: `pperson${stamp}`,
                publicUsername: `Printables Person ${stamp}`,
                avatarFilePath: "media/a.png",
              },
              stls: [],
            },
          },
        });
      },
    });

    const run = newRun();
    await runAuthorLinking(run);
    const authorId = `printables:p-${stamp}`;
    // The site's display name differs from the stored name; linked anyway.
    expect(await authorOf(first.id)).toBe(authorId);
    expect(await authorOf(second.id)).toBe(authorId);
    expect(modelQueries).toBe(1);
    expect(run.linked).toBeGreaterThanOrEqual(2);
    expect((await prisma.author.findUniqueOrThrow({ where: { id: authorId } })).avatarUrl).toBe(
      "https://media.printables.com/media/a.png",
    );
  });

  it("uses the model owner's MakerWorld login to read MakerWorld's API", async () => {
    const designId = String((stamp % 1_000_000_000) + 7);
    await prisma.user.update({ where: { id: userId }, data: { makerworldCookie: "token=owner-bearer" } });
    const print = await unattributedPrint("lookup-mw", "makerworld", `mw-nick-${stamp}`);
    await prisma.print.update({ where: { id: print.id }, data: { sourceExternalId: designId } });
    let authorization: string | null = null;
    global.fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const url = String(input);
      if (url === `https://api.bambulab.com/v1/design-service/design/${designId}`) {
        authorization = new Headers(init?.headers).get("authorization");
        return json({
          id: Number(designId),
          designCreator: {
            uid: 777000 + (stamp % 1000),
            name: `MW Person ${stamp}`,
            avatar: "https://public-cdn.bblmw.com/a.png",
          },
        });
      }
      return new Response("not found", { status: 404 }); // the author profile: behind Cloudflare
    }) as unknown as typeof fetch;

    await runAuthorLinking(newRun());
    expect(authorization).toBe("Bearer owner-bearer");
    expect(await authorOf(print.id)).toBe(`makerworld:${777000 + (stamp % 1000)}`);
    await prisma.user.update({ where: { id: userId }, data: { makerworldCookie: null } });
  });

  it("skips Thingiverse without an App Token, and says so", async () => {
    await setThingiverseAccessToken(null);
    const print = await unattributedPrint("lookup-tv", "thingiverse", `TvPerson${stamp}`);
    mockFetch({});
    const run = newRun();
    await runAuthorLinking(run);
    expect(run.problems).toContain("thingiverse_no_token");
    expect(await authorOf(print.id)).toBeNull();
  });

  it("reads Cults3D with the key of an owner who has one, even when another owner's model is newer", async () => {
    const keyed = await request(app)
      .post("/api/register")
      .send({
        displayName: "Cults3D Key Owner",
        email: `author-linking-c3d-${stamp}@example.com`,
        password: "password123",
      });
    const keyedUserId: string = keyed.body.user.id;
    await prisma.user.update({
      where: { id: keyedUserId },
      data: { cults3dNick: `keyed${stamp}`, cults3dApiKey: "secret" },
    });
    const creator = `c3d-creator-${stamp}`;
    const older = await prisma.print.create({
      data: {
        userId: keyedUserId,
        name: `c3d-keyed ${stamp}`,
        nameNormalized: `c3d-keyed ${stamp}`,
        creator,
        sourceProvider: "cults3d",
        sourceExternalId: `c3d-keyed-${stamp}`,
      },
    });
    const newer = await unattributedPrint("c3d-unkeyed", "cults3d", creator);
    await prisma.print.update({ where: { id: newer.id }, data: { createdAt: new Date(Date.now() + 60_000) } });
    let authorization: string | null = null;
    global.fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      if (String(input) !== "https://cults3d.com/graphql") return new Response("not found", { status: 404 });
      authorization = new Headers(init?.headers).get("authorization");
      return json({ data: { creation: { slug: `c3d-keyed-${stamp}`, name: "Anything", creator: { nick: creator } } } });
    }) as unknown as typeof fetch;

    await runAuthorLinking(newRun());
    expect(authorization).toBe(`Basic ${Buffer.from(`keyed${stamp}:secret`).toString("base64")}`);
    expect(await authorOf(older.id)).toBe(`cults3d:${creator}`);
    expect(await authorOf(newer.id)).toBe(`cults3d:${creator}`);
  });

  it("skips a Cults3D creator no owner has a key for, and says a key is missing", async () => {
    const print = await unattributedPrint("c3d-nokey", "cults3d", `c3d-nokey-${stamp}`);
    mockFetch({});
    const run = newRun();
    await runAuthorLinking(run);
    expect(run.problems).toContain("cults3d_no_key");
    // Other files' leftover models may be looked up too; none of it is Cults3D's.
    const urls = vi.mocked(global.fetch).mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.startsWith("https://cults3d.com"))).toEqual([]);
    expect(await authorOf(print.id)).toBeNull();
  });
});

describe("Administration > Triggers > Link missing authors", () => {
  // Files share one database; leave the token as this file found it, even when a test fails.
  let previousToken: string | null;
  // Lets a run held open by a test finish, even when the test fails before letting it.
  let answer: (() => void) | null = null;

  beforeAll(async () => {
    previousToken = await getThingiverseAccessToken();
  });

  afterEach(() => {
    answer?.();
    answer = null;
    global.fetch = originalFetch;
  });

  afterAll(async () => {
    await setThingiverseAccessToken(previousToken);
  });

  it("is admin-only", async () => {
    expect((await request(app).get("/api/admin/triggers/link-authors").set(auth(memberToken))).status).toBe(403);
    expect((await request(app).post("/api/admin/triggers/link-authors").set(auth(memberToken))).status).toBe(403);
  });

  it("says what it can link -- which decides whether it's shown -- then links it in the background", async () => {
    // One author to look up on Thingiverse, whose answer waits until the second start has been tried: the run
    // otherwise finishes in milliseconds, and whether it's still going when asked again is down to timing.
    const answered = new Promise<void>((resolve) => (answer = resolve));
    global.fetch = vi.fn<() => Promise<Response>>(async () => {
      await answered;
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    await setThingiverseAccessToken("test-token");
    await unattributedPrint("trigger-wait", "thingiverse", `Somebody Else ${stamp}`);
    const author = await prisma.author.create({
      data: {
        id: `thingiverse:trigger-${stamp}`,
        provider: "thingiverse",
        externalId: `trigger-${stamp}`,
        name: `Trigger Author ${stamp}`,
      },
    });
    const first = await unattributedPrint("trigger-a", "thingiverse", `Trigger Author ${stamp}`);
    const second = await unattributedPrint("trigger-b", "thingiverse", `trigger author ${stamp}`);
    const status = await request(app).get("/api/admin/triggers/link-authors").set(auth(adminToken));
    expect(status.body.linkable).toBeGreaterThanOrEqual(2);
    expect(status.body).toHaveProperty("lookup");

    const started = await request(app).post("/api/admin/triggers/link-authors").set(auth(adminToken));
    expect(started.status).toBe(200);
    expect(started.body.run.running).toBe(true);
    expect((await request(app).post("/api/admin/triggers/link-authors").set(auth(adminToken))).status).toBe(409);
    answer?.();

    let run = started.body.run;
    for (let i = 0; i < 100 && run.running; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      run = (await request(app).get("/api/admin/triggers/link-authors").set(auth(adminToken))).body.run;
    }
    expect(run.running).toBe(false);
    expect(run.linked).toBeGreaterThanOrEqual(2);
    expect(await authorOf(first.id)).toBe(author.id);
    expect(await authorOf(second.id)).toBe(author.id);
  });
});
