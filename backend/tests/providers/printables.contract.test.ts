import { vi } from "vitest";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import { binary, json, loadFixture, threeMf, type FetchHandler } from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// Printables end to end: its public GraphQL API answers everything without a sign-in, a model's files through download
// links it hands out per request. Answers are the recorded shapes in fixtures/providers/printables (its own suites'
// printablesImport and printablesCollection).

const GRAPHQL = "https://api.printables.com/graphql/";
const MODEL_ID = "1786545";
const COLLECTION_ID = "2348006";
const COLLECTION_URL = `https://www.printables.com/@joshuaargh/collections/${COLLECTION_ID}`;

function handlerFor(scenario: string): FetchHandler {
  return async ({ url, json: body }) => {
    if (url.hostname === "files.printables.com") return binary(await threeMf(url.pathname));
    // Its pictures, on media.printables.com, fall through to the stub's own PNG.
    if (url.href !== GRAPHQL) return undefined;
    const query = String(body?.query ?? "");
    if (query.includes("getDownloadLink")) return json(loadFixture("printables", "download-link"));
    if (query.includes("moreCollectionModels")) return json(loadFixture("printables", "collection-models"));
    if (query.includes("collection(id:")) {
      return json(scenario === "gone" ? { data: { collection: null } } : loadFixture("printables", "collection"));
    }
    if (query.includes("print(id:")) {
      return json(scenario === "missing" ? { data: { print: null } } : loadFixture("printables", "model"));
    }
    return undefined;
  };
}

const spec: ProviderContractSpec = {
  id: "printables",
  name: "Printables",
  modelUrl: `https://www.printables.com/model/${MODEL_ID}-strong-garden-hose-holder`,
  expected: {
    externalId: MODEL_ID,
    title: "Strong garden hose holder",
    // Its HTML description as Markdown.
    notesIncludes: "#### Mounting\n\n4 x M5 or M6 screws",
    author: "s0ren",
    tags: ["Garden", "Hose"],
    // By its category id, 42, which the starter categories file under Fashion whatever the site calls it.
    category: { name: "Other Fashion Models", parent: "Fashion" },
    // The cover, which the gallery lists too, and the one other picture.
    galleryImages: 2,
    plateInstanceIds: [null],
    plateFilenames: ["garden-hose-holder.3mf"],
  },
  // There's no sign-in to keep.
  connect: async () => undefined,
  disconnect: async () => undefined,
  createHandler: handlerFor,
  reimport: {},
  list: {
    endpoint: "/api/import/printables-collection/entries",
    url: COLLECTION_URL,
    title: "Printing for printing's sake",
    importedId: MODEL_ID,
    freshId: "1482294",
  },
  // A public collection, which anyone reads; the model Printables took down is left out.
  listing: {
    sync: { externalId: COLLECTION_ID, sourceUrl: COLLECTION_URL },
    ids: [MODEL_ID, "1482294"],
    needsSignIn: false,
  },
  skip: {
    missingCredentials: "Printables has no sign-in: its public API answers every import",
    rejectedCredentials: "Printables has no sign-in to turn down",
  },
};

describeProviderContract(spec);
