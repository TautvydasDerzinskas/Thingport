import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { checkImportStatus } from "../src/services/importService";

// A Creality Cloud model linked by its id is kept under its alias, so the status of the id link has to find it there.

const app = createApp();
const MODEL_ID = "6ac6f004729f5ba4b3574093";
const ALIAS = `status-alias-${Date.now()}`;

let userId: string;

function stubDetail() {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
    const path = new URL(url).pathname.replace(/^\/api\/cxy/, "");
    const result =
      path === "/v3/model/modelGroupDetail"
        ? { groupItem: { id: MODEL_ID, urlAlias: ALIAS, groupName: "Snap-Clip Fidget" }, modelList: [] }
        : { list: [], count: 0 };
    return new Response(JSON.stringify({ code: 0, msg: "ok", reqId: "r", result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Creality Cloud import status", () => {
  beforeAll(async () => {
    const email = `crealitycloud-status-test-${Date.now()}@example.com`;
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Creality Cloud Status Test", email, password: "password123" });
    if (res.status !== 200) throw new Error(`Failed to register: ${res.status} ${JSON.stringify(res.body)}`);
    userId = res.body.user.id;
    await prisma.print.create({
      data: {
        userId,
        name: "Snap-Clip Fidget",
        nameNormalized: "snap-clip fidget",
        sourceProvider: "crealitycloud",
        sourceExternalId: ALIAS,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("finds a model kept under its alias by its id link, asking the site once", async () => {
    const fetchMock = stubDetail();
    const idUrl = `https://www.crealitycloud.com/model-detail/${MODEL_ID}`;
    expect(await checkImportStatus(userId, idUrl)).toMatchObject({ already_imported: true, state: "imported" });
    const calls = fetchMock.mock.calls.length;
    expect(await checkImportStatus(userId, idUrl)).toMatchObject({ already_imported: true });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("finds it by its alias link without asking the site", async () => {
    const fetchMock = stubDetail();
    const status = await checkImportStatus(userId, `https://www.crealitycloud.com/model-detail/${ALIAS}`);
    expect(status).toMatchObject({ already_imported: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
