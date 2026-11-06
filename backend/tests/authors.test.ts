import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { upsertAuthorFromImport } from "../src/services/authorService";
import type { ImportedAuthorInfo } from "../src/services/importResolvers";

// Name-only models link to an author record, but only when the match is unambiguous.

const app = createApp();
const stamp = Date.now();
let userId: string;
let memberToken: string;

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
    // Imported again, as the next model of theirs would be: still two authors with that name.
    await upsertAuthorFromImport(authorInfo("makerworld", "twin-a", `Twin${stamp}`));
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
});

describe("what a deleted model leaves behind", () => {
  it("takes its author and the pictures of its tags, and keeps ones another model still needs", async () => {
    const author = (externalId: string, name: string) =>
      prisma.author.create({
        data: { id: `thingiverse:${externalId}`, provider: "thingiverse", externalId, name, links: [] },
      });
    const shared = await author(`shared-${stamp}`, "Shared Author");
    const only = await author(`only-${stamp}`, "Only Author");

    const make = (name: string, authorId: string, tags: string[]) =>
      prisma.print.create({ data: { userId, name, nameNormalized: name.toLowerCase(), authorId, tags } });
    const staying = await make(`staying-${stamp}`, shared.id, ["shared-tag"]);
    const going = await make(`going-${stamp}`, only.id, ["Shared-Tag", "lonely-tag"]);
    // A bookmark and a mosaic exist for both tags, as they would once the tags had been browsed.
    await request(app).post("/api/tags/lonely-tag/bookmark").set(auth(memberToken));
    await request(app).post("/api/tags/shared-tag/bookmark").set(auth(memberToken));

    expect((await request(app).delete(`/api/print/${going.id}`).set(auth(memberToken))).status).toBe(200);

    // The author nothing else is by goes; the one another model is by stays.
    expect(await prisma.author.findUnique({ where: { id: only.id } })).toBeNull();
    expect(await prisma.author.findUnique({ where: { id: shared.id } })).not.toBeNull();
    // The same for the tags: one is still on the model that stayed, the other is on nothing.
    const bookmarked = (await prisma.bookmark.findMany({ where: { userId, type: "TAG" } })).map((mark) =>
      (mark.tag ?? "").toLowerCase(),
    );
    expect(bookmarked).toContain("shared-tag");
    expect(bookmarked).not.toContain("lonely-tag");

    await prisma.print.delete({ where: { id: staying.id } });
  });
});
