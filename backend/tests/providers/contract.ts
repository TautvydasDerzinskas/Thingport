/* oxlint-disable vitest/no-conditional-expect, vitest/no-conditional-tests, vitest/no-disabled-tests, vitest/expect-expect, vitest/valid-title --
   the tests are generated from a provider's spec, so which assertions run, skip or differ is the spec's, by design. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/db";
import { fetchListing } from "../../src/services/collectionSyncRunner";
import { setProviderEnabled } from "../../src/services/providerSettingsService";
import { expectStatus, type FetchHandler, type FetchStub, installFetch } from "./support";

// The provider contract suite (docs/PROVIDER_DEVELOPMENT.md). `describeProviderContract(spec)` pins what an
// import from one provider does, end to end through the HTTP routes, with the provider's answers stubbed from the
// recorded fixtures in tests/fixtures/providers/<id>/ -- never a real site. It is the acceptance test for a new
// provider too: register one, write its spec, and the same assertions run against it.
//
// A test file using it must mock DNS first (the import route resolves the link's host), as providerImports.test.ts does:
//
//   vi.mock("node:dns/promises", () => ({ default: { resolve4: async () => ["93.184.216.34"], resolve6: async () => { throw new Error("no AAAA"); } } }));
//
// What each assertion pins, by `ContractAssertion`:
//   import               POST /api/import of the model's link creates a print with sourceProvider/sourceExternalId,
//                        the author, the category its site category ids map to (categorySource RULE; none for a
//                        provider whose models don't say theirs), the gallery and the plates (with the profile each
//                        belongs to).
//   reimport             The same link again is answered `already_imported` without asking the provider anything;
//                        for a provider with print profiles, a link naming another profile adds its plate
//                        (`profile_added`).
//   missingCredentials   Without the user's stored sign-in: 400 with the provider's own `<id>_session` code, and
//                        nothing imported.
//   rejectedCredentials  When the provider turns the sign-in down: 400 with that code, the connection is remembered as
//                        "expired", and nothing imported; asking again fails the same way.
//   providerDisabled     An admin turning the provider off: 403 `provider_disabled` for a new link, nothing asked. A
//                        model already in the library is still reported as imported, except for providers with
//                        profiles, which would fetch for a new one (the route refuses those too).
//   listAlreadyImported  The provider's list import (`/import/<x>/entries`) flags the models already in the library
//                        and is refused while the provider is off.
//   fillGaps             "Fetch missing details" (`POST /print/:id/fill-gaps`, fillGapsService.fetchSourceMeta) fills
//                        every empty field of a bare print of the provider from its details, and asks nothing once
//                        there is nothing to fill; a model the provider no longer has is a 404 that fills nothing.
//   fetchListing         Collection sync's `fetchListing` (collectionSyncRunner.ts) returns the collection's model
//                        ids in the provider's order, null when the provider says the collection is gone, and throws
//                        when it can't tell (an outage never unsyncs anything).
//
// A provider that can't be asserted one way declares why in `skip`, and the suite lists it as skipped with that reason.

export type ContractAssertion =
  | "import"
  | "reimport"
  | "missingCredentials"
  | "rejectedCredentials"
  | "providerDisabled"
  | "listAlreadyImported"
  | "fillGaps"
  | "fetchListing";

export type ProviderContractSpec = {
  /** The provider's id, as `sourceProvider` keeps it. */
  id: string;
  name: string;
  /** A model link the provider's import takes. */
  modelUrl: string;
  /** Request fields beside `url` the import needs (MakerOnline's Grab-signed files). */
  importBody?: () => Record<string, unknown>;
  expected: {
    /** What `sourceExternalId` ends up as. */
    externalId: string;
    title: string;
    notesIncludes: string;
    author: string;
    /** The model's tags as the library keeps them, sorted. */
    tags: string[];
    /** The seeded category the model's site category ids map to; null for a provider whose models don't say their
     *  category (manifest `categoryIds: "none"`), so the import comes uncategorized and fill-gaps leaves it. */
    category: { name: string; parent: string | null } | null;
    /** Pictures kept as the model's gallery (the cover included). */
    galleryImages: number;
    /** False where the provider's models carry no description at all (OwlCAD's library parts), so fill-gaps has
     *  nothing to fill one from and leaves it among the gaps that remain. */
    description?: false;
    /** The profile each plate belongs to, in order; null for a plate that isn't a profile's. */
    plateInstanceIds: (string | null)[];
    plateFilenames?: string[];
  };
  /** Stores the user's sign-in (all of it, where the provider has several parts). */
  connect(userId: string): Promise<void>;
  /** Forgets it. */
  disconnect(userId: string): Promise<void>;
  /** The provider's answers for a scenario, fresh for each test: "ok" and "rejected" (the provider turns the sign-in
   *  down), and "list" for the list import's fetches. A provider may define more for its own tests. */
  createHandler(scenario: string): FetchHandler;
  credentials?: {
    /** The code of the 400 an import answers with when the sign-in is missing or turned down. */
    sessionCode: string;
    /** "connected", "disconnected" or "expired", as the provider's session service reports it. */
    connection(userId: string): Promise<string>;
  };
  reimport: {
    /** A link (and body) naming a profile the first import didn't bring: providers with profiles only. */
    profile?: { url: string; body?: () => Record<string, unknown>; plateInstanceIds: (string | null)[] };
  };
  list?: {
    endpoint: string;
    url: string;
    title: string;
    /** In the list, and put in the library by the test. */
    importedId: string;
    /** In the list, and not in the library. */
    freshId: string;
  };
  /** What collection sync reads: a sync's identity, and the model ids `fetchListing` returns for the "list" scenario.
   *  The "gone" scenario must answer as the provider does for a collection that no longer exists, and every scenario
   *  must answer "missing" as it does for a model it no longer has. */
  listing?: {
    sync: { externalId: string; sourceUrl: string };
    ids: string[];
    /** The provider's collection can't be read without the user's sign-in (the listing then throws without it). */
    needsSignIn: boolean;
    /** The listing is the user's own and is never "gone": the "gone" assertion doesn't apply. */
    neverGone?: boolean;
  };
  /** Assertions that don't apply, each with why. */
  skip?: Partial<Record<ContractAssertion, string>>;
};

export type ContractContext = {
  readonly userId: string;
  readonly spec: ProviderContractSpec;
  /** Stubs fetch with the provider's answers for `scenario`. */
  stub(scenario?: string): FetchStub;
  /** Stubs fetch with a handler of the test's own (a variant of the provider's answers). */
  install(handler: FetchHandler): FetchStub;
  post(path: string, body: Record<string, unknown>): Promise<request.Response>;
  /** POST /api/import. */
  importUrl(url?: string, body?: Record<string, unknown>): Promise<request.Response>;
  prints(): Promise<Awaited<ReturnType<typeof prisma.print.findMany>>>;
};

const ASSERTIONS: ContractAssertion[] = [
  "import",
  "reimport",
  "missingCredentials",
  "rejectedCredentials",
  "providerDisabled",
  "listAlreadyImported",
  "fillGaps",
  "fetchListing",
];

export function describeProviderContract(spec: ProviderContractSpec): ContractContext {
  const app = createApp();
  let userId = "";
  let token = "";
  let stub: FetchStub | null = null;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  // An import leaves work behind that outlives its response (previews, descriptions, activity, authors). Whatever of it
  // fetches would otherwise land in the next stub, and break an exact "asked nothing" or call-list assertion in a test
  // that follows, only when the machine is slow. So a request is over for a test once the stub has been quiet a moment.
  const settle = async () => {
    const watched = stub;
    if (!watched) return;
    for (let round = 0; round < 40; round++) {
      const seen = watched.calls.length;
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (watched.calls.length === seen) return;
    }
  };
  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await request(app).post(path).set(auth()).send(body);
    await settle();
    return res;
  };
  const ctx: ContractContext = {
    get userId() {
      return userId;
    },
    spec,
    // "outage" is the same for every provider: whatever is asked, the site answers 500.
    stub: (scenario = "ok") =>
      ctx.install(
        scenario === "outage" ? () => new Response("upstream down", { status: 500 }) : spec.createHandler(scenario),
      ),
    install(handler) {
      stub?.restore();
      stub = installFetch(handler);
      return stub;
    },
    post,
    importUrl: (url = spec.modelUrl, body) => post("/api/import", { url, tags: [], ...spec.importBody?.(), ...body }),
    prints: () => prisma.print.findMany({ where: { userId, sourceProvider: spec.id }, orderBy: { createdAt: "asc" } }),
  };

  const plateInstanceIds = async (printId: string) =>
    (await prisma.plate.findMany({ where: { printId }, orderBy: { position: "asc" } })).map((p) => p.sourceInstanceId);
  /** The seeded category the spec's model maps to; null for a provider with none. */
  const expectedCategory = async () => {
    const expected = spec.expected.category;
    if (!expected) return null;
    return prisma.category.findFirstOrThrow({
      where: { userId, name: expected.name, ...(expected.parent ? { parent: { name: expected.parent } } : {}) },
    });
  };

  beforeAll(async () => {
    const res = await request(app)
      .post("/api/register")
      .send({
        displayName: `${spec.name} Contract`,
        email: `contract-${spec.id}-${Date.now()}@example.com`,
        password: "password123",
      });
    if (res.status !== 200) throw new Error(`Failed to register: ${res.status} ${JSON.stringify(res.body)}`);
    userId = res.body.user.id;
    token = res.body.token;
  });

  afterEach(async () => {
    await settle();
    stub?.restore();
    stub = null;
    await setProviderEnabled(spec.id as never, true);
    await prisma.print.deleteMany({ where: { userId, sourceProvider: spec.id } });
    await spec.disconnect(userId);
  });

  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  const test = (assertion: ContractAssertion, title: string, run: () => Promise<void>) => {
    const reason = spec.skip?.[assertion];
    if (reason) it.skip(`${title} -- skipped: ${reason}`, run);
    else it(title, run);
  };

  describe(`provider contract: ${spec.id}`, () => {
    test(
      "import",
      "imports a model link into a print with its source, author, rule-based category and gallery",
      async () => {
        await spec.connect(userId);
        // The fixture's site category ids must map to a seeded category.
        const category = await expectedCategory();

        const stubbed = ctx.stub("ok");
        const res = await ctx.importUrl();
        expectStatus(res, 200);
        expect(res.body.import_outcome).toBe("created");
        expect(stubbed.calls.length).toBeGreaterThan(0);

        const [print] = await ctx.prints();
        expect(print).toBeDefined();
        expect(print.id).toBe(res.body.id);
        expect(print.sourceProvider).toBe(spec.id);
        expect(print.sourceExternalId).toBe(spec.expected.externalId);
        expect(print.title).toBe(spec.expected.title);
        if (spec.expected.description === false) expect(print.notes).toBeNull();
        else expect(print.notes).toContain(spec.expected.notesIncludes);
        expect(print.tags.toSorted()).toEqual(spec.expected.tags);
        expect(print.creator).toBe(spec.expected.author);
        expect(print.categoryId).toBe(category?.id ?? null);
        expect(print.categorySource).toBe(category ? "RULE" : null);
        const author = await prisma.author.findUnique({ where: { id: print.authorId! } });
        expect(author?.name).toBe(spec.expected.author);
        expect(author?.provider).toBe(spec.id);
        expect(await prisma.previewImage.count({ where: { printId: print.id, generated: false } })).toBe(
          spec.expected.galleryImages,
        );
        expect(await plateInstanceIds(print.id)).toEqual(spec.expected.plateInstanceIds);
        if (spec.expected.plateFilenames) {
          const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
          expect(plates.map((plate) => plate.filename)).toEqual(spec.expected.plateFilenames);
        }
      },
    );

    test(
      "reimport",
      spec.reimport.profile
        ? "a second import of the link is already imported without asking the site; a link naming another profile adds its plate"
        : "a second import of the link is already imported without asking the site",
      async () => {
        await spec.connect(userId);
        ctx.stub("ok");
        expect((await ctx.importUrl()).status).toBe(200);

        const again = ctx.stub("ok");
        const second = await ctx.importUrl();
        expectStatus(second, 200);
        expect(second.body.import_outcome).toBe("already_imported");
        expect(again.calls.map((call) => String(call.url))).toEqual([]);
        expect(await ctx.prints()).toHaveLength(1);

        const profile = spec.reimport.profile;
        if (!profile) return;
        ctx.stub("ok");
        const added = await ctx.importUrl(profile.url, profile.body?.());
        expectStatus(added, 200);
        expect(added.body.import_outcome).toBe("profile_added");
        const prints = await ctx.prints();
        expect(prints).toHaveLength(1);
        expect(await plateInstanceIds(prints[0].id)).toEqual(profile.plateInstanceIds);

        // Naming a profile it has now is nothing new either.
        const nothing = ctx.stub("ok");
        const third = await ctx.importUrl(profile.url, profile.body?.());
        expect(third.body.import_outcome).toBe("already_imported");
        expect(nothing.calls.map((call) => String(call.url))).toEqual([]);
      },
    );

    test(
      "missingCredentials",
      "without the user's sign-in the import is refused with the provider's session code",
      async () => {
        await spec.disconnect(userId);
        ctx.stub("ok");
        const res = await ctx.importUrl();
        expectStatus(res, 400);
        expect(res.body.code).toBe(spec.credentials!.sessionCode);
        expect(await ctx.prints()).toHaveLength(0);
        // Nothing is "expired" for a user who never connected.
        expect(await spec.credentials!.connection(userId)).toBe("disconnected");
      },
    );

    test(
      "rejectedCredentials",
      "a sign-in the provider turns down is remembered, and answered with the session code",
      async () => {
        await spec.connect(userId);
        expect(await spec.credentials!.connection(userId)).toBe("connected");
        ctx.stub("rejected");
        const res = await ctx.importUrl();
        expectStatus(res, 400);
        expect(res.body.code).toBe(spec.credentials!.sessionCode);
        expect(await spec.credentials!.connection(userId)).toBe("expired");
        expect(await ctx.prints()).toHaveLength(0);

        // Rejected stays rejected until the user connects again.
        ctx.stub("ok");
        const again = await ctx.importUrl();
        expect(again.status).toBe(400);
        expect(again.body.code).toBe(spec.credentials!.sessionCode);
      },
    );

    test("providerDisabled", "an admin turning the provider off refuses new links with provider_disabled", async () => {
      await spec.connect(userId);
      await setProviderEnabled(spec.id as never, false);
      const refused = ctx.stub("ok");
      const res = await ctx.importUrl();
      expectStatus(res, 403);
      expect(res.body.code).toBe("provider_disabled");
      expect(refused.calls).toHaveLength(0);
      expect(await ctx.prints()).toHaveLength(0);

      // A model already in the library: still reported, unless a re-import could fetch (providers with profiles).
      await prisma.print.create({
        data: {
          userId,
          name: "Already here",
          nameNormalized: "already here",
          sourceProvider: spec.id,
          sourceExternalId: spec.expected.externalId,
        },
      });
      const known = await ctx.importUrl();
      if (spec.reimport.profile) {
        expectStatus(known, 403);
        expect(known.body.code).toBe("provider_disabled");
      } else {
        expectStatus(known, 200);
        expect(known.body.import_outcome).toBe("already_imported");
      }
      expect(refused.calls).toHaveLength(0);

      await setProviderEnabled(spec.id as never, true);
      expect((await ctx.importUrl()).status).not.toBe(403);
    });

    test("listAlreadyImported", "a list's entries flag the models already in the library", async () => {
      const list = spec.list!;
      await spec.connect(userId);
      await prisma.print.create({
        data: {
          userId,
          name: "Already here",
          nameNormalized: "already here",
          sourceProvider: spec.id,
          sourceExternalId: list.importedId,
        },
      });
      ctx.stub("list");
      const res = await post(list.endpoint, { url: list.url });
      expectStatus(res, 200);
      expect(res.body.title).toBe(list.title);
      const flags = Object.fromEntries(
        (res.body.entries as { design_id: string; already_imported: boolean }[]).map((entry) => [
          entry.design_id,
          entry.already_imported,
        ]),
      );
      expect(flags[list.importedId]).toBe(true);
      expect(flags[list.freshId]).toBe(false);

      await setProviderEnabled(spec.id as never, false);
      const off = await post(list.endpoint, { url: list.url });
      expect(off.status).toBe(403);
      expect(off.body.code).toBe("provider_disabled");
    });

    test(
      "fillGaps",
      "fills a bare print's empty details from the provider, and asks nothing once they're filled",
      async () => {
        await spec.connect(userId);
        const category = await expectedCategory();
        const print = await prisma.print.create({
          data: {
            userId,
            name: "Bare",
            nameNormalized: "bare",
            sourceProvider: spec.id,
            sourceExternalId: spec.expected.externalId,
          },
        });
        const fill = () => post(`/api/print/${print.id}/fill-gaps`, {});

        // A model the provider no longer has: 404, and nothing is marked as unfillable for it.
        ctx.stub("missing");
        const gone = await fill();
        expectStatus(gone, 404);
        expect((await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).unfillableGaps).toEqual([]);

        ctx.stub("ok");
        const res = await fill();
        expectStatus(res, 200);
        const describes = spec.expected.description !== false;
        expect(res.body.filled.toSorted()).toEqual([
          "author",
          ...(category ? ["category"] : []),
          "creator",
          ...(describes ? ["description"] : []),
          "images",
          "tags",
          "title",
        ]);
        // A provider whose models don't say their category, or carry no description, leaves that gap: there's
        // nothing to fill it from.
        expect(res.body.remaining.toSorted()).toEqual(
          [...(category ? [] : ["category"]), ...(describes ? [] : ["description"])].toSorted(),
        );
        const filled = await prisma.print.findUniqueOrThrow({ where: { id: print.id }, include: { author: true } });
        expect(filled.title).toBe(spec.expected.title);
        if (spec.expected.description === false) expect(filled.notes).toBeNull();
        else expect(filled.notes).toContain(spec.expected.notesIncludes);
        expect(filled.tags.toSorted()).toEqual(spec.expected.tags);
        expect(filled.creator).toBe(spec.expected.author);
        expect(filled.author?.name).toBe(spec.expected.author);
        expect(filled.categoryId).toBe(category?.id ?? null);
        expect(filled.categorySource).toBe(category ? "RULE" : null);
        expect(await prisma.previewImage.count({ where: { printId: print.id, generated: false } })).toBe(
          spec.expected.galleryImages,
        );

        // Nothing left to fill: the provider isn't asked.
        const quiet = ctx.stub("ok");
        const again = await fill();
        expect(again.status).toBe(200);
        expect(again.body.filled).toEqual([]);
        expect(quiet.calls).toHaveLength(0);
      },
    );

    test(
      "fetchListing",
      "collection sync lists the collection's model ids, null when it's gone, and fails on an outage",
      async () => {
        const listing = spec.listing!;
        const sync = { userId, provider: spec.id, ...listing.sync };
        await spec.connect(userId);

        ctx.stub("list");
        expect(await fetchListing(sync)).toEqual(listing.ids);

        if (!listing.neverGone) {
          ctx.stub("gone");
          expect(await fetchListing(sync)).toBeNull();
        }

        // Not knowing is not the collection being gone.
        ctx.stub("outage");
        await expect(fetchListing(sync)).rejects.toThrow(/./);

        await spec.disconnect(userId);
        ctx.stub("list");
        if (listing.needsSignIn) await expect(fetchListing(sync)).rejects.toThrow(/./);
        else expect(await fetchListing(sync)).toEqual(listing.ids);
      },
    );
  });

  // A contract with an assertion neither run nor declared skipped is a hole.
  describe(`provider contract: ${spec.id} -- declarations`, () => {
    it("declares why each assertion it lacks the means for is skipped", () => {
      const lacking: Partial<Record<ContractAssertion, boolean>> = {
        missingCredentials: !spec.credentials,
        rejectedCredentials: !spec.credentials,
        listAlreadyImported: !spec.list,
        fetchListing: !spec.listing,
      };
      for (const assertion of ASSERTIONS) {
        if (lacking[assertion])
          expect({ assertion, why: spec.skip?.[assertion] }).toEqual({ assertion, why: expect.any(String) });
      }
    });
  });

  return ctx;
}
