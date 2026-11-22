import { describe, expect, it, vi } from "vitest";
import { isMyminifactoryFileHost } from "../../src/providers/myminifactory/api";
import { setMyminifactoryApiKey } from "../../src/providers/myminifactory/apiKey";
import { getMyminifactoryConnection, setUserMyminifactoryCookie } from "../../src/providers/myminifactory/session";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import {
  assertThat,
  binary,
  expectStatus,
  html,
  json,
  loadFixture,
  redirect,
  stl,
  zip,
  type FetchHandler,
} from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// MyMiniFactory end to end, two keys. Its API v2 reads objects and collections with the instance's API key (`?key=`,
// an admin's); a free object's files come from its /download link, which redirects anyone to a signed one. Paid and
// login-only objects download as the user, with their session, from their library. Answers are the recorded shapes in
// fixtures/providers/myminifactory (its own suites' myminifactoryImport and myminifactoryApi).

const API_KEY = "test-api-key";
const SESSION = "PHPSESSID=abc123";
const OBJECT_ID = "9990077";
const MODEL_URL = `https://www.myminifactory.com/object/3d-print-test-skull-${OBJECT_ID}`;
const COLLECTION_URL = "https://www.myminifactory.com/users/schmick101/collection/steampunk";
const SIGNED_ZIP = "https://dl4.myminifactory.com/object-assets/test/generated-zips/skull.zip?X-Amz-Signature=x";

/** `model`: "free", the object above; "login-only", the same one with archives whose Download button sends a visitor to
 *  sign in, so they come from the user's library. "rejected": MyMiniFactory sends the library's calls to its sign-in,
 *  as for a session it no longer takes. */
function handlerFor(scenario: string, model: "free" | "login-only" = "free"): FetchHandler {
  return async ({ url, headers }) => {
    if (isMyminifactoryFileHost(url.hostname)) {
      const part = url.pathname.match(/\/extracted-files\/(\d+)\.stl$/);
      if (part) return binary(stl(part[1]));
      return binary(
        await zip("myminifactory-skull", {
          "skull/skull.stl": stl("skull"),
          "skull/moustache.stl": stl("moustache"),
          "skull/readme.pdf": Buffer.from("%PDF-1.4 fake"),
        }),
      );
    }
    // Its pictures, on assets.myminifactory.com, fall through to the stub's own PNG.
    if (url.hostname !== "www.myminifactory.com") return undefined;
    const path = url.pathname;
    if (path.startsWith("/api/v2/")) {
      assertThat(url.searchParams.get("key") === API_KEY, "the API is asked with the instance's key");
      if (path === `/api/v2/objects/${OBJECT_ID}`) {
        if (scenario === "missing") return json({ status: 404 }, 404);
        const object = loadFixture("myminifactory", "object");
        return json(model === "login-only" ? { ...object, file_mode: 1 } : object);
      }
      if (path === "/api/v2/users/schmick101/collections/steampunk") {
        return scenario === "gone" ? json({ status: 404 }, 404) : json(loadFixture("myminifactory", "collection"));
      }
      return undefined;
    }
    if (path === `/object/${OBJECT_ID}`) {
      const button = {
        isLoggedIn: false,
        archives: [
          { id: 70, path: "Skull.zip", size: "100", download_url: `${url.origin}/download/${OBJECT_ID}?archive_id=70` },
        ],
      };
      return html(
        `<script type="application/json" data-component-name="DownloadButton">${JSON.stringify(button)}</script>`,
      );
    }
    if (path === `/download/${OBJECT_ID}`) {
      // A login-only archive sends a visitor back to the object's page.
      if (url.searchParams.has("archive_id")) return redirect(`/object/3d-print-test-skull-${OBJECT_ID}`);
      return redirect(SIGNED_ZIP);
    }
    if (path.startsWith("/api/data-library/")) {
      assertThat(headers.cookie === SESSION, "the library is read with the user's session");
      if (scenario === "rejected") return redirect("https://www.myminifactory.com/login");
      if (path === `/api/data-library/myObjects/object-${OBJECT_ID}/downloadables`) {
        return json({
          archives: [
            {
              id: 55,
              name: "Skull.zip",
              extractedFiles: [
                { id: 901, path: "Skull/skull.stl", size: "100" },
                { id: 903, path: "Skull/moustache.stl", size: "100" },
              ],
            },
          ],
          pdfs: [],
          parts: [],
        });
      }
      const contents = path.match(/^\/api\/data-library\/archive-file-contents\/(\d+)\/download$/);
      if (contents)
        return redirect(`https://dl4.myminifactory.com/object-assets/test/extracted-files/${contents[1]}.stl`);
    }
    return undefined;
  };
}

const spec: ProviderContractSpec = {
  id: "myminifactory",
  name: "MyMiniFactory",
  modelUrl: MODEL_URL,
  expected: {
    externalId: OBJECT_ID,
    title: "Test Skull Pen Holder",
    notesIncludes: "A **skull** pen holder.",
    author: "Test Designer",
    tags: ["Desk", "Skull"],
    category: { name: "Office", parent: "Household" },
    galleryImages: 1,
    // The zip's model files, a plate each; the PDF isn't one.
    plateInstanceIds: [null, null],
    plateFilenames: ["skull.stl", "moustache.stl"],
  },
  // Both keys: the instance's API key, which an admin saves, and the user's own session.
  connect: async (userId) => {
    await setMyminifactoryApiKey(API_KEY);
    await setUserMyminifactoryCookie(userId, SESSION);
  },
  disconnect: async (userId) => {
    await setMyminifactoryApiKey(null);
    await setUserMyminifactoryCookie(userId, null);
  },
  createHandler: (scenario) => handlerFor(scenario),
  credentials: { sessionCode: "myminifactory_session", connection: getMyminifactoryConnection },
  reimport: {},
  list: {
    endpoint: "/api/import/myminifactory-collection/entries",
    url: COLLECTION_URL,
    title: "Steampunk",
    importedId: OBJECT_ID,
    freshId: "9990078",
  },
  // Read with the instance's API key, which a sync can't do without; the store object in it is left out.
  listing: {
    sync: { externalId: "schmick101/steampunk", sourceUrl: COLLECTION_URL },
    ids: [OBJECT_ID, "9990078"],
    needsSignIn: true,
  },
  skip: {
    missingCredentials:
      "every import needs the instance's API key, its absence a 503 for an admin; a free object needs no user sign-in, and a login-only one without it is a 403 with no session code (pinned below)",
    rejectedCredentials:
      "a free object never uses the user's session; one turned down on a login-only object is a 400 with the code, marked expired (pinned below), yet the next import sends it again",
  },
};

const ctx = describeProviderContract(spec);

describe("MyMiniFactory specifics", () => {
  it("refuses a login-only object without the user's sign-in with 403 and no session code", async () => {
    await setMyminifactoryApiKey(API_KEY);
    ctx.install(handlerFor("ok", "login-only"));
    const res = await ctx.importUrl();
    expectStatus(res, 403);
    expect(res.body.code).toBeUndefined();
    expect(res.body.detail).toMatch(/downloads only when signed in/);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("answers a session MyMiniFactory turns down with the session code, and marks it expired", async () => {
    await spec.connect(ctx.userId);
    ctx.install(handlerFor("rejected", "login-only"));
    const res = await ctx.importUrl();
    expectStatus(res, 400);
    expect(res.body.code).toBe("myminifactory_session");
    expect(await getMyminifactoryConnection(ctx.userId)).toBe("expired");
    expect(await ctx.prints()).toHaveLength(0);
  });
});
