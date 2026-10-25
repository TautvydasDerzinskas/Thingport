import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { setThingiverseAccessToken } from "../src/providers/thingiverse/token";

// Administration > Triggers: refetching every imported model's description for one user.

const STEP_IMAGE = "https://media.printables.com/media/prints/refetch-step.gif";
const ONE_PIXEL_GIF_BASE64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function mockPrintables(descriptions: Record<string, string>) {
  return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = String(input);
    if (url === "https://api.printables.com/graphql/") {
      const { variables } = JSON.parse(String(init?.body ?? "{}")) as { variables?: { id?: string } };
      const id = variables?.id ?? "";
      if (!(id in descriptions)) return json({ data: { print: null } });
      return json({
        data: { print: { id, name: `Model ${id}`, description: descriptions[id], tags: [], images: [] } },
      });
    }
    if (url === STEP_IMAGE) return new Response(Buffer.from(ONE_PIXEL_GIF_BASE64, "base64"), { status: 200 });
    throw new Error(`Unexpected fetch to ${url}`);
  }) as unknown as typeof fetch;
}

describe("refetching a user's descriptions", () => {
  const app = createApp();
  const originalFetch = global.fetch;
  let adminToken: string;
  let memberToken: string;
  let memberId: string;
  let memberEmail: string;

  beforeAll(async () => {
    const stamp = Date.now();
    const admin = await request(app)
      .post("/api/register")
      .send({ displayName: "Refetch Admin", email: `refetch-admin-${stamp}@example.com`, password: "password123" });
    await prisma.user.update({ where: { id: admin.body.user.id }, data: { role: "ADMIN" } });
    // Tokens carry the role from when they were issued.
    const login = await request(app)
      .post("/api/login")
      .send({ email: `refetch-admin-${stamp}@example.com`, password: "password123" });
    adminToken = login.body.token;
    const member = await request(app)
      .post("/api/register")
      .send({ displayName: "Refetch Member", email: `refetch-member-${stamp}@example.com`, password: "password123" });
    memberToken = member.body.token;
    memberId = member.body.user.id;
    memberEmail = member.body.user.email;
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    await setThingiverseAccessToken(null);
  });

  async function createPrint(name: string, notes: string, externalId: string | null, provider = "printables") {
    return prisma.print.create({
      data: {
        userId: memberId,
        name,
        nameNormalized: name.toLowerCase(),
        notes,
        sourceProvider: externalId ? provider : null,
        sourceExternalId: externalId,
      },
    });
  }

  async function waitForRun() {
    for (;;) {
      const res = await request(app)
        .get("/api/admin/triggers/refetch-descriptions")
        .set("Authorization", `Bearer ${adminToken}`);
      if (!res.body.run?.running) return res.body;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  it("is admin-only", async () => {
    const res = await request(app)
      .post("/api/admin/triggers/refetch-descriptions")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ user_id: memberId });
    expect(res.status).toBe(403);
  });

  it("replaces imported descriptions with the source's, formatting and images included", async () => {
    const imported = await createPrint("Imported", "Old plain text", "9100001");
    const gone = await createPrint("Gone from source", "Kept as it is", "9100002");
    const uploaded = await createPrint("Uploaded", "Not from a source", null);
    global.fetch = mockPrintables({ "9100001": `<p>Now <strong>formatted</strong></p><img src="${STEP_IMAGE}">` });

    const counts = await request(app)
      .get("/api/admin/triggers/refetch-descriptions")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(counts.body.counts[memberId]).toBe(2);

    const start = await request(app)
      .post("/api/admin/triggers/refetch-descriptions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ user_id: memberId });
    expect(start.status).toBe(200);
    const { run } = await waitForRun();
    expect(run).toMatchObject({ userId: memberId, total: 2, done: 2, updated: 1, failed: 1, problems: [] });

    const image = await prisma.descriptionImage.findFirstOrThrow({ where: { printId: imported.id } });
    const after = await prisma.print.findMany({ where: { id: { in: [imported.id, gone.id, uploaded.id] } } });
    const notesOf = (id: string) => after.find((p) => p.id === id)?.notes;
    expect(notesOf(imported.id)).toBe(`Now **formatted**\n\n![](/description-image/${image.id})`);
    expect(notesOf(gone.id)).toBe("Kept as it is");
    expect(notesOf(uploaded.id)).toBe("Not from a source");
  });

  it("logs whose descriptions were refetched, not just the admin who ran it", async () => {
    // The entry is written fire-and-forget as the run ends, so it may land a moment later.
    const findLog = () => prisma.log.findFirst({ where: { action: "descriptions_refetched", targetId: memberId } });
    let log = await findLog();
    for (let attempt = 0; !log && attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      log = await findLog();
    }
    expect(log?.details).toMatchObject({ email: memberEmail, total: 2, updated: 1, failed: 1 });
  });

  it("doesn't download the images again on a second run", async () => {
    const fetchMock = mockPrintables({ "9100001": `<p>Now <strong>formatted</strong></p><img src="${STEP_IMAGE}">` });
    global.fetch = fetchMock;
    await request(app)
      .post("/api/admin/triggers/refetch-descriptions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ user_id: memberId });
    const { run } = await waitForRun();
    // Same description as last time, so nothing changed.
    expect(run.updated).toBe(0);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain(STEP_IMAGE);
  });

  it("stops asking Thingiverse once it rate-limits, and says so", async () => {
    await setThingiverseAccessToken("test-token");
    await createPrint("Thing one", "One", "9200001", "thingiverse");
    await createPrint("Thing two", "Two", "9200002", "thingiverse");
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input, init) => {
        if (String(input).startsWith("https://api.thingiverse.com/")) return new Response("", { status: 429 });
        return mockPrintables({ "9100001": "<p>Now <strong>formatted</strong></p>" })(input, init);
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await request(app)
      .post("/api/admin/triggers/refetch-descriptions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ user_id: memberId });
    const { run } = await waitForRun();

    expect(run.problems).toEqual(["thingiverse_rate_limited"]);
    const thingiverseCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).startsWith("https://api.thingiverse.com/"),
    );
    expect(thingiverseCalls).toHaveLength(1);
    expect(run.failed).toBe(3); // both Things, plus the Printables model the source no longer has
  });
});
