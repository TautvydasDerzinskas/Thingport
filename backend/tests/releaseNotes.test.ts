import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import {
  announceVersionUpdate,
  clearReleaseNotesCache,
  getReleaseNotes,
  isQuietRelease,
  notesFromChangelogs,
  parseChangelog,
  parseCuratedNotes,
} from "../src/services/releaseNotesService";

const BACKEND_CHANGELOG = `# Thingport backend changelog

# [thingport-backend-v1.2.0](https://github.com/o/r/compare/a...b) (2026-11-02)


### Bug Fixes

* **zip:** keep non-ASCII names readable ([060be2f](https://github.com/o/r/commit/060be2f1)), closes [#9](https://github.com/o/r/issues/9)
* shared fix ([aaaaaaa](https://github.com/o/r/commit/aaaaaaa1))


### Features

* add MCP endpoint, closing ([#16](https://github.com/o/r/issues/16)) ([bbbbbbb](https://github.com/o/r/commit/bbbbbbb1))

## [thingport-backend-v1.1.1](https://github.com/o/r/compare/a...b) (2026-10-25)


### Performance Improvements

* load listings faster ([ccccccc](https://github.com/o/r/commit/ccccccc1))

# thingport-backend-v1.1.0 (2026-10-20)


### Features

* old feature ([ddddddd](https://github.com/o/r/commit/ddddddd1))
`;

const FRONTEND_CHANGELOG = `# Thingport frontend changelog

# [thingport-frontend-v1.3.0](https://github.com/o/r/compare/a...b) (2026-11-02)


### Bug Fixes

* shared fix ([aaaaaaa](https://github.com/o/r/commit/aaaaaaa1))


### Features

* pick an accent colour ([eeeeeee](https://github.com/o/r/commit/eeeeeee1))

# [thingport-frontend-v1.2.0](https://github.com/o/r/compare/a...b) (2026-10-20)


### Features

* old frontend feature ([fffffff](https://github.com/o/r/commit/fffffff1))
`;

describe("release notes", () => {
  it("parses a semantic-release changelog", () => {
    const releases = parseChangelog(BACKEND_CHANGELOG);
    expect(releases.map((r) => [r.version, r.date])).toEqual([
      ["1.2.0", "2026-11-02"],
      ["1.1.1", "2026-10-25"],
      ["1.1.0", "2026-10-20"],
    ]);
    expect(releases[0].items[0]).toMatchObject({
      kind: "fix",
      scope: "zip",
      title: "Keep non-ASCII names readable",
      url: "https://github.com/o/r/commit/060be2f1",
      sha: "060be2f",
    });
    expect(releases[1].items[0].kind).toBe("improvement");
  });

  it("takes one release, features first, with the frontend's from the same day and shared commits once", () => {
    const items = notesFromChangelogs(parseChangelog(BACKEND_CHANGELOG), parseChangelog(FRONTEND_CHANGELOG), {
      version: "1.2.0",
      frontendVersion: "1.3.0",
    });
    expect(items.map((i) => [i.kind, i.title])).toEqual([
      ["feature", "Add MCP endpoint, closing (#16)"],
      ["feature", "Pick an accent colour"],
      ["fix", "Keep non-ASCII names readable"],
      ["fix", "Shared fix"],
    ]);
  });

  it("covers every release since the version updated from", () => {
    const items = notesFromChangelogs(parseChangelog(BACKEND_CHANGELOG), parseChangelog(FRONTEND_CHANGELOG), {
      version: "1.2.0",
      since: "1.1.0",
    });
    expect(items.map((i) => i.title)).toContain("Load listings faster");
    expect(items.map((i) => i.title)).not.toContain("Old feature");
    expect(items.map((i) => i.title)).not.toContain("Old frontend feature");
  });

  it("leaves out a frontend release newer than the one running", () => {
    const items = notesFromChangelogs(parseChangelog(BACKEND_CHANGELOG), parseChangelog(FRONTEND_CHANGELOG), {
      version: "1.2.0",
      frontendVersion: "1.2.0",
    });
    expect(items.map((i) => i.title)).not.toContain("Pick an accent colour");
  });

  it("takes only the releases before the version, and not its frontend, for curated notes that cover it", () => {
    const items = notesFromChangelogs(parseChangelog(BACKEND_CHANGELOG), parseChangelog(FRONTEND_CHANGELOG), {
      version: "1.2.0",
      since: "1.1.0",
      frontendVersion: "1.3.0",
      earlierOnly: true,
    });
    expect(items.map((i) => i.title)).toEqual(["Load listings faster"]);
    expect(notesFromChangelogs(parseChangelog(BACKEND_CHANGELOG), [], { version: "1.2.0", earlierOnly: true })).toEqual(
      [],
    );
  });

  it("adds skipped releases from the changelog after curated notes", async () => {
    const files: Record<string, string> = {
      "/release-notes/latest-release-notes.json": JSON.stringify({
        version: "1.2.0",
        items: [{ type: "feature", title: "Curated feature" }],
      }),
      "/backend/CHANGELOG.md": BACKEND_CHANGELOG,
      "/frontend/CHANGELOG.md": FRONTEND_CHANGELOG,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const body = files[new URL(String(input)).pathname];
      return new Response(body ?? "", { status: body ? 200 : 404 });
    });
    try {
      clearReleaseNotesCache();
      const notes = await getReleaseNotes({ version: "1.2.0", since: "1.1.0" }, "https://notes.example");
      expect(notes?.source).toBe("curated");
      expect(notes?.items.map((i) => [i.title, i.url])).toEqual([
        ["Curated feature", null],
        ["Load listings faster", null],
      ]);

      const direct = await getReleaseNotes({ version: "1.2.0" }, "https://notes.example");
      expect(direct?.items.map((i) => i.title)).toEqual(["Curated feature"]);
    } finally {
      fetchMock.mockRestore();
      clearReleaseNotesCache();
    }
  });

  it("resolves curated screenshots against the file and drops unsafe ones", () => {
    const notes = parseCuratedNotes(
      {
        version: "1.2.0",
        items: [
          {
            type: "feature",
            title: "Accents",
            images: [
              { src: "screenshots/accent.png", caption: "Graphite" },
              { src: "https://example.com/a.png" },
              { src: "javascript:alert(1)" },
            ],
          },
          { type: "fix", title: "A fix", highlight: true, code: "claude mcp add thingport" },
        ],
      },
      "https://raw.example.com/repo/main/release-notes/latest-release-notes.json",
    );
    expect(notes?.items[0].images).toEqual([
      { url: "https://raw.example.com/repo/main/release-notes/screenshots/accent.png", caption: "Graphite" },
      { url: "https://example.com/a.png", caption: null },
    ]);
    expect(notes?.items[1]).toMatchObject({ highlight: true, code: "claude mcp add thingport" });
    expect(notes?.items[0]).toMatchObject({ highlight: false, code: null });
    expect(parseCuratedNotes({ version: "next", items: [] }, "https://x.example/a.json")).toBeNull();
  });
});

describe("version update notification", () => {
  const app = createApp();
  const run = Date.now();
  let user: { id: string; token: string };
  const updates = () => prisma.notification.findMany({ where: { userId: user.id, type: "system" } });
  const VERSION_KEYS = ["last_run_version", "last_announced_version"];
  const ranBefore = (version: string) =>
    prisma.$transaction(
      VERSION_KEYS.map((key) =>
        prisma.setting.upsert({ where: { key }, create: { key, value: version }, update: { value: version } }),
      ),
    );
  // Never reaches the network: the quiet list is given.
  const announce = (version: string, quiet: string[] = []) =>
    announceVersionUpdate(version, new Date(), async (v) => quiet.includes(v));

  beforeAll(async () => {
    const email = `release-notes-${run}@example.com`;
    const res = await request(app).post("/api/register").send({ displayName: "R", email, password: "password123" });
    const login = await request(app).post("/api/login").send({ email, password: "password123" });
    user = { id: res.body.user.id as string, token: login.body.token as string };
  });

  // An announcement goes to every user in the shared test database, not only this file's.
  const clearAnnouncements = () =>
    prisma.notification.deleteMany({ where: { type: "system", internalPath: { startsWith: "?whats-new=" } } });

  beforeEach(async () => {
    await prisma.notification.deleteMany({ where: { userId: user.id } });
    await prisma.setting.deleteMany({ where: { key: { in: VERSION_KEYS } } });
  });

  afterEach(clearAnnouncements);

  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { key: { in: VERSION_KEYS } } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  });

  it("tells users once when a newer version starts, but not on a restart or a downgrade", async () => {
    await ranBefore("1.1.0");
    expect(await announce("1.2.0")).toBe(true);
    const [notification] = await updates();
    expect(notification.internalPath).toBe("?whats-new=1.2.0&since=1.1.0");

    expect(await announce("1.2.0")).toBe(false);
    expect(await announce("1.1.5")).toBe(false);
    expect(await updates()).toHaveLength(1);
  });

  it("tells existing users when the version that ran before isn't known", async () => {
    expect(await announce("1.2.0")).toBe(true);
    expect((await updates())[0].internalPath).toBe("?whats-new=1.2.0");
  });

  it("doesn't announce a version again after going down from it and back up", async () => {
    await ranBefore("1.1.0");
    expect(await announce("1.2.0")).toBe(true);
    expect(await announce("1.1.0")).toBe(false);
    expect(await announce("1.2.0")).toBe(false);
    expect(await updates()).toHaveLength(1);
  });

  it("notifies once when two processes start on the new version together", async () => {
    await ranBefore("1.1.0");
    const results = await Promise.all([announce("1.2.0"), announce("1.2.0")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await updates()).toHaveLength(1);
  });

  it("skips a quiet release, and covers it in the next announcement's notes", async () => {
    await ranBefore("1.2.0");
    expect(await announce("1.2.1", ["1.2.1"])).toBe(false);
    // A restart doesn't announce it even when the quiet list can't be read.
    expect(await announce("1.2.1")).toBe(false);
    expect(await updates()).toHaveLength(0);

    expect(await announce("1.3.0")).toBe(true);
    expect((await updates())[0].internalPath).toBe("?whats-new=1.3.0&since=1.2.0");
  });

  it("reads quiet releases from the repo file, and treats an unreadable one as not quiet", async () => {
    let body: string | null = JSON.stringify({ versions: ["1.2.1", 7] });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(body ?? "", { status: body === null ? 404 : 200 }));
    try {
      clearReleaseNotesCache();
      expect(await isQuietRelease("1.2.1", "https://notes.example")).toBe(true);
      expect(await isQuietRelease("1.3.0", "https://notes.example")).toBe(false);
      body = "not json";
      clearReleaseNotesCache();
      expect(await isQuietRelease("1.2.1", "https://notes.example")).toBe(false);
      body = null;
      clearReleaseNotesCache();
      expect(await isQuietRelease("1.2.1", "https://notes.example")).toBe(false);
      expect(await isQuietRelease("1.2.1", "")).toBe(false);
    } finally {
      fetchMock.mockRestore();
      clearReleaseNotesCache();
    }
  });
});
