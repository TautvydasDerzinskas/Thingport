// Publishes a built Edge zip to the existing Microsoft Edge Add-ons listing, through the Edge
// Add-ons Update REST API v1.1 (https://learn.microsoft.com/microsoft-edge/extensions/update/api/using-addons-api):
// upload the package to the listing's draft submission, wait for it to be processed, submit the
// draft for certification, and wait for that to be accepted. Certification itself then takes
// Microsoft anywhere from hours to days -- this only gets the update into the queue.
//
//   EDGE_PRODUCT_ID=... EDGE_CLIENT_ID=... EDGE_API_KEY=... \
//     tsx scripts/publish-edge.ts dist/zips/thingport-grab-edge.zip [--notes-file <path> | --notes "..."]
//
// Edge requires complete certification notes (under 2,000 characters) with every submission, and
// may fail one that only points at an earlier one. --notes-file fills a template's {{version}},
// {{changes}} and {{testServer}} from RELEASE_VERSION, RELEASE_TAG and EDGE_REVIEW_TEST_SERVER (a
// secret: a reviewer account on a test server); see edge-certification-notes.txt.
// `--check-notes <path>` only checks a template fits (npm run check:edge-notes, run in CI).
//
// Run by .github/workflows/extension-store-release.yml for each new version (see
// extension/CONTRIBUTING.md for setting up the credentials).
// EDGE_API_BASE overrides the API root, for testing against a mock.

import { readFile } from "node:fs/promises";

const API_BASE = process.env.EDGE_API_BASE || "https://api.addons.microsoftedge.microsoft.com";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const NOTES_MAX_CHARS = 2000;
const REPO_URL = "https://github.com/TautvydasDerzinskas/Thingport";
// Without a reviewer account, the reviewer runs a server of their own.
const SELF_HOSTED_TEST_SERVER =
  "No shared test server is provided. Start one with Docker in about two minutes (Linux or macOS) by " +
  "running: curl -fsSL https://thingport.net/install.sh | WEB_PORT=8080 sh\nThen open " +
  "http://localhost:8080 and register; the first account becomes the admin. Use http://localhost:8080 " +
  "as the server address in step 2.";

type Operation = {
  id?: string;
  status?: "InProgress" | "Succeeded" | "Failed" | string;
  message?: string | null;
  errorCode?: string | null;
  errors?: unknown[] | null;
};

// What the documented failure codes mean for whoever reads the CI log.
const ERROR_HINTS: Record<string, string> = {
  InProgressSubmission:
    "A previous submission is still in certification. Wait for Microsoft to finish reviewing it, then re-run this workflow.",
  NoModulesUpdated: "The uploaded package is identical to the published one -- bump the version in package.json.",
  UnpublishInProgress: "The listing is being unpublished in Partner Center.",
  CreateNotAllowed: "The product ID doesn't belong to an existing listing -- check the EDGE_PRODUCT_ID variable.",
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} isn't set`);
  return value;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** The template with its placeholders filled and its `#` comment lines dropped; refuses notes Edge would
 *  reject. --check-notes fills it with a long version and tag, so a template that passes still fits on release. */
async function notesFromTemplate(path: string, check = false): Promise<string> {
  const version = check ? "99.99.99" : process.env.RELEASE_VERSION?.trim() || "update";
  const tag = check ? `thingport-grab-v${version}` : process.env.RELEASE_TAG?.trim();
  const values: Record<string, string> = {
    version,
    changes: tag ? `${REPO_URL}/releases/tag/${tag}` : `${REPO_URL}/blob/main/extension/CHANGELOG.md`,
    testServer: (!check && process.env.EDGE_REVIEW_TEST_SERVER?.trim()) || SELF_HOSTED_TEST_SERVER,
  };
  const notes = (await readFile(path, "utf8"))
    .replace(/^#.*(\r?\n|$)/gm, "")
    .replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match)
    .trim();
  const unfilled = notes.match(/\{\{\w+\}\}/);
  if (unfilled) throw new Error(`${path}: unknown placeholder ${unfilled[0]}`);
  if (notes.length >= NOTES_MAX_CHARS) {
    throw new Error(
      `Certification notes are ${notes.length} characters; Edge allows under ${NOTES_MAX_CHARS}. Shorten ${path}.`,
    );
  }
  return notes;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A 202 whose Location header carries the operation to poll (documented as the bare ID; a
 *  full URL is tolerated too). */
async function startOperation(url: string, init: RequestInit, what: string): Promise<string> {
  const res = await fetch(url, init);
  if (res.status !== 202) {
    const body = await res.text().catch(() => "");
    const hint =
      res.status === 401
        ? " -- the API key or client ID is wrong, or the key has expired (Partner Center > Publish API)."
        : "";
    throw new Error(`${what} failed: HTTP ${res.status} ${body}${hint}`);
  }
  const location = res.headers.get("location");
  if (!location) throw new Error(`${what}: no operation ID in the response`);
  return location.replace(/\/+$/, "").split("/").pop()!;
}

async function waitFor(url: string, auth: Record<string, string>, what: string): Promise<Operation> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const res = await fetch(url, { headers: auth });
    if (!res.ok)
      throw new Error(`${what}: status check failed with HTTP ${res.status} ${await res.text().catch(() => "")}`);
    const operation = (await res.json()) as Operation;
    if (operation.status !== "InProgress") {
      if (operation.status === "Succeeded") return operation;
      const hint = operation.errorCode ? ERROR_HINTS[operation.errorCode] : undefined;
      const details = operation.errors?.length ? `\n  ${JSON.stringify(operation.errors)}` : "";
      throw new Error(
        `${what} failed (${operation.errorCode || "no error code"}): ${operation.message}${details}${hint ? `\n  ${hint}` : ""}`,
      );
    }
    if (Date.now() > deadline) throw new Error(`${what} still in progress after ${POLL_TIMEOUT_MS / 60000} minutes`);
    await sleep(POLL_INTERVAL_MS);
  }
}

async function main(): Promise<void> {
  const checkPath = argValue("--check-notes");
  if (checkPath) {
    const notes = await notesFromTemplate(checkPath, true);
    console.log(`${checkPath}: ${notes.length} of ${NOTES_MAX_CHARS - 1} characters filled in.`);
    return;
  }
  const zipPath = process.argv
    .slice(2)
    .find((arg, i, all) => !arg.startsWith("--") && all[i - 1] !== "--notes" && all[i - 1] !== "--notes-file");
  if (!zipPath) {
    throw new Error("Usage: tsx scripts/publish-edge.ts <package.zip> [--notes-file <path> | --notes <text>]");
  }
  // Checked before the upload, so a too-long note doesn't leave a half-done draft behind.
  const notesFile = argValue("--notes-file");
  const notes = notesFile
    ? await notesFromTemplate(notesFile)
    : (argValue("--notes") ?? "Automated update. Testing instructions are unchanged from the previous submission.");
  const productId = requireEnv("EDGE_PRODUCT_ID");
  const auth = { Authorization: `ApiKey ${requireEnv("EDGE_API_KEY")}`, "X-ClientID": requireEnv("EDGE_CLIENT_ID") };
  const productUrl = `${API_BASE}/v1/products/${productId}`;

  const zip = await readFile(zipPath);
  console.log(`Uploading ${zipPath} (${(zip.length / 1024).toFixed(1)} KB) to Edge Add-ons product ${productId}…`);
  const uploadId = await startOperation(
    `${productUrl}/submissions/draft/package`,
    { method: "POST", headers: { ...auth, "Content-Type": "application/zip" }, body: zip },
    "Upload",
  );
  const uploaded = await waitFor(`${productUrl}/submissions/draft/package/operations/${uploadId}`, auth, "Upload");
  console.log(`Upload processed: ${uploaded.message ?? "ok"}`);

  const publishId = await startOperation(
    `${productUrl}/submissions`,
    { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ notes }) },
    "Submission",
  );
  const submitted = await waitFor(`${productUrl}/submissions/operations/${publishId}`, auth, "Submission");
  console.log(`Submitted for certification: ${submitted.message ?? "ok"}`);
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
