import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db";
import { MEDIA_DIR, mediaAddress, sendRemoteMedia } from "../src/federation/media";
import { forgetPeerContent } from "../src/federation/remoteIndex";

// A partner's picture held mid-way: what it sends is made here, and signing is left out.
const { federationFetch } = vi.hoisted(() => ({
  federationFetch: vi.fn<(...args: unknown[]) => Promise<Response>>(),
}));
vi.mock("../src/federation/fetch", async (original) => ({
  ...(await original<typeof import("../src/federation/fetch")>()),
  federationFetch: (...args: unknown[]) => federationFetch(...args),
}));
vi.mock("../src/federation/runtime", async (original) => ({
  ...(await original<typeof import("../src/federation/runtime")>()),
  getRuntime: async () => ({
    fedify: { signRequest: async (req: Request) => req },
    keys: { rsa: { privateKey: null } },
    keyId: new URL("http://192.0.2.80/api/ap/actors/instance#main-key"),
  }),
}));

const PARTNER = "http://203.0.113.81";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
let peerId: string;

const app = express().get("/media/:token", (req, res) => void sendRemoteMedia(req.params.token, res, "viewer"));
const tokenOf = (url: string) => mediaAddress(url)!.split("/").pop()!;
const KEPT = `${PARTNER}/api/ap/media/avatar/kept?v=1`;
const LATE = `${PARTNER}/api/ap/media/image/late?v=1`;
const AFTER = `${PARTNER}/api/ap/media/image/after?v=1`;

/** Someone of the partner's with `avatar`, and a model of theirs with `images`: what names its pictures here. */
async function keep(avatar: string | null, images: string[]): Promise<void> {
  const person = await prisma.remotePerson.create({
    data: { peerId, apId: `${PARTNER}/api/ap/actors/ana`, displayName: "Ana", avatarUrl: avatar },
  });
  await prisma.remoteModel.create({
    data: { peerId, personId: person.id, apId: `${PARTNER}/api/ap/models/m1`, title: "Hook", images },
  });
}

beforeAll(async () => {
  await prisma.peer.deleteMany({ where: { origin: PARTNER } });
  peerId = (
    await prisma.peer.create({
      data: { origin: PARTNER, status: "ACTIVE", actorUrl: `${PARTNER}/api/ap/actors/instance` },
    })
  ).id;
  await keep(KEPT, [LATE, AFTER]);
});

afterAll(async () => {
  await prisma.peer.deleteMany({ where: { origin: PARTNER } });
  fs.rmSync(path.join(MEDIA_DIR, peerId), { recursive: true, force: true });
});

describe("a partner's pictures", () => {
  it("keeps one it fetched, to send again", async () => {
    federationFetch.mockResolvedValueOnce(new Response(PNG, { headers: { "Content-Type": "image/png" } }));
    const res = await request(app).get(`/media/${tokenOf(KEPT)}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    expect(fs.readdirSync(path.join(MEDIA_DIR, peerId))).toHaveLength(2);
    // Sent from what's kept: the partner isn't asked again.
    expect((await request(app).get(`/media/${tokenOf(KEPT)}`)).status).toBe(200);
    expect(federationFetch).toHaveBeenCalledTimes(1);
  });

  it("sends none that nothing kept here names, and doesn't ask the partner for it", async () => {
    const res = await request(app).get(`/media/${tokenOf(`${PARTNER}/api/ap/media/image/unnamed?v=1`)}`);
    expect(res.status).toBe(404);
    expect(federationFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps nothing of one still coming when its partner is forgotten", async () => {
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    federationFetch.mockImplementationOnce(
      async () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(PNG);
              await held;
              controller.close();
            },
          }),
          { headers: { "Content-Type": "image/png" } },
        ),
    );
    const answered = request(app)
      .get(`/media/${tokenOf(LATE)}`)
      .then((res) => res);
    await vi.waitFor(() => expect(federationFetch).toHaveBeenCalledTimes(2));

    // Forgetting waits for it; it finishes; nothing of it, or of the partner's others, is left.
    const forgetting = forgetPeerContent(peerId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    finish();
    await forgetting;
    expect((await answered).status).toBe(404);
    expect(fs.existsSync(path.join(MEDIA_DIR, peerId))).toBe(false);
    // And one asked for after is turned away, not fetched, even named again by a read finishing meanwhile.
    await keep(null, [AFTER]);
    expect((await request(app).get(`/media/${tokenOf(AFTER)}`)).status).toBe(404);
    expect(federationFetch).toHaveBeenCalledTimes(2);
  });
});
