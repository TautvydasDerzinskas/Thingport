import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { makePrint, register, upload } from "./helpers/fileReuse";

// A supporting file shown in place (GET /print/:id/files/:fileId?inline=1): only a kind that's safe there, sent as
// a type no browser runs, never sniffed, framed in a sandbox but for a PDF; anything else downloads as always.

const app = createApp();
let dir: string;
let owner: { id: string; token: string };
let printId: string;
const ids = new Map<string, string>();
const TEXT = "text/plain; charset=utf-8";

const FILES: [name: string, contents: string, shown: { type: string; sandbox: boolean } | null][] = [
  ["Guide.pdf", "%PDF-1.4\n%%EOF\n", { type: "application/pdf", sandbox: false }],
  ["Photo.png", "\x89PNG\r\n\x1a\n", { type: "image/png", sandbox: true }],
  ["README.md", "# Frog\n", { type: TEXT, sandbox: true }],
  ["notes.txt", "Print at 0.2 mm.\n", { type: TEXT, sandbox: true }],
  ["Parts.csv", "part,qty\nscrew,4\n", { type: TEXT, sandbox: true }],
  ["frog.scad", "cube(10);\n", { type: TEXT, sandbox: true }],
  ["Logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', null],
  ["page.html", "<script>alert(1)</script>", null],
  ["Guide.docx", "PK\x03\x04", null],
];

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "inline-files-"));
  owner = await register(app, "inline", "Inline");
  printId = (await makePrint(dir, owner.id, "Inline")).print.id;
  for (const [name, contents] of FILES) ids.set(name, (await upload(dir, owner.id, printId, name, contents)).id);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: owner.id } });
  fs.rmSync(dir, { recursive: true, force: true });
});

const get = (name: string, query = "") =>
  request(app)
    .get(`/api/print/${printId}/files/${ids.get(name)}${query}`)
    .set({ Authorization: `Bearer ${owner.token}` })
    .buffer(true);

describe("a supporting file shown in place", () => {
  it.each(FILES.filter(([, , shown]) => shown))(
    "shows %s as a type no browser runs",
    async (name, _contents, shown) => {
      const res = await get(name, "?inline=1");

      expect(res.status).toBe(200);
      expect(res.headers).toMatchObject({
        "content-type": shown!.type,
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      });
      expect(res.headers["content-disposition"]).toMatch(/^inline;/);
      expect(res.headers["content-security-policy"]).toBe(shown!.sandbox ? "sandbox" : undefined);
    },
  );

  it.each(FILES.filter(([, , shown]) => !shown))("downloads %s even when asked to show it", async (name) => {
    const res = await get(name, "?inline=1");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });

  it("downloads any file asked for without ?inline=1", async () => {
    const res = await get("Guide.pdf");

    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });
});
