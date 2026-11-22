import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import request from "supertest";
import { STORAGE } from "../../src/config";
import { prisma } from "../../src/db";
import { DEFAULT_MCP_TOOL_NAMES } from "../../src/mcp/tools";
import { consumeFolder, NOT_IMPORTED_DIR, setConsumeSettings } from "../../src/services/consumeService";
import { binary, html, json, type FetchHandler } from "../providers/support";
import { filesOf, type FileTree } from "./files";
import type { Way } from "./cases";

// Each way in, driven as its callers drive it: the routes a client calls, the MCP tools, the consume folder on a
// folder of its own, and imports with every site's answer stubbed. What each made is read back from the database, so
// a case sees exactly what a person would find in their library afterwards.

export type Account = { id: string; session: string };

/** A model as its owner finds it: its plates in order (P), then its other files: the prepared print (PP), supporting
 *  files (S) and the LICENSE.txt Thingport writes (L), any not on the disk marked missing; and how many photos its
 *  gallery has. */
export type Model = { name: string; folder?: string; files: string[]; photos: number };

/** What a way in made of a case: the models (or the model added to), what it refused and why, and the files it named
 *  as left out (the consume folder's "Not imported", a zip job's failed entries). */
export type Outcome = { refused?: string; models: Model[]; left?: string[] };

/** An outcome as the cases table writes it: what was refused first, a line per model, then what was left out. */
export function linesOf(outcome: Outcome): string[] {
  const photos = (count: number) => (count ? `, ${count} photo${count === 1 ? "" : "s"}` : "");
  return [
    ...(outcome.refused ? [`✕ ${outcome.refused}`] : []),
    ...outcome.models.map(
      (model) =>
        `${model.name}${model.folder ? ` (in ${model.folder})` : ""}: ${model.files.join(", ") || "no files"}${photos(model.photos)}`,
    ),
    ...(outcome.left?.length ? [`left: ${outcome.left.join(", ")}`] : []),
  ];
}

let accounts = 0;

export async function register(app: Express, label: string): Promise<Account> {
  const email = `intake-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${Date.now()}-${accounts++}@example.com`;
  const res = await request(app).post("/api/register").send({ displayName: "Intake", email, password: "password123" });
  if (res.status !== 200) throw new Error(`register: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.user.id, session: res.body.token };
}

const auth = (account: Account, token = account.session) => ({ Authorization: `Bearer ${token}` });

const refusal = (res: { status: number; body: { detail?: string } }) => `${res.status} ${res.body.detail ?? ""}`.trim();

/** The user's models, oldest first, as their library shows them: plates in order, then the files beside them. */
export async function modelsOf(userId: string): Promise<Model[]> {
  const prints = await prisma.print.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      plates: { orderBy: { position: "asc" } },
      files: true,
      previewImages: { where: { generated: false } },
    },
  });
  // A file the row names but the disk doesn't hold says so: an outcome is what someone could open, not only its rows.
  const named = (file: { folder: string | null; filename: string }, at: string) =>
    `${file.folder ? `${file.folder}/${file.filename}` : file.filename}${fs.existsSync(at) ? "" : " (missing)"}`;
  // "PP" only for the model's own prepared print; "pp" for a file kept as one that the model doesn't point at.
  const role = { PREPARED: "pp", SUPPORTING: "S", LICENSE: "L" } as const;
  const categories = new Map(
    (await prisma.category.findMany({ where: { userId } })).map((category) => [category.id, category]),
  );
  /** The library folders a model is filed in, outermost first. */
  const folderOf = (id: string | null): string | undefined => {
    const names: string[] = [];
    for (let at = id ? categories.get(id) : undefined; at; at = at.parentId ? categories.get(at.parentId) : undefined) {
      names.unshift(at.name);
    }
    return names.length ? names.join("/") : undefined;
  };
  return prints.map((print) => {
    const model: Model = {
      name: print.title || print.name,
      files: [
        ...print.plates.map((plate) => `P ${named(plate, plate.sourcePath ?? path.join(STORAGE, plate.storagePath))}`),
        ...print.files
          .map(
            (file) =>
              `${print.preparedFileId === file.id ? "PP" : role[file.role]} ${named(file, path.join(STORAGE, file.storagePath))}`,
          )
          .toSorted(),
      ],
      photos: print.previewImages.length,
    };
    const folder = folderOf(print.categoryId);
    if (folder) model.folder = folder;
    return model;
  });
}

/** The files of a folder below `root`, by path from it, sorted. */
function listed(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out.toSorted();
}

/** The tree's files on a multipart request by name alone, as a browser sends them: an upload has no folders. */
async function attachAll(req: request.Test, tree: FileTree, seed: string, field: string) {
  for (const file of await filesOf(tree, seed)) req.attach(field, file.bytes, { filename: path.basename(file.path) });
  return req;
}

async function writeTree(dir: string, tree: FileTree, seed: string) {
  for (const file of await filesOf(tree, seed)) {
    const abs = path.join(dir, file.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.bytes);
  }
}

async function base64Files(tree: FileTree, seed: string) {
  return (await filesOf(tree, seed)).map((file) => ({
    name: path.basename(file.path),
    base64: file.bytes.toString("base64"),
  }));
}

function mcpCall(app: Express, token: string, name: string, args: Record<string, unknown>) {
  return request(app)
    .post("/api/mcp")
    .set("Accept", "application/json, text/event-stream")
    .set("Content-Type", "application/json")
    .set({ Authorization: `Bearer ${token}` })
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
    .then((res) => {
      const result = res.body.result as { isError?: boolean; content: { text: string }[] } | undefined;
      if (!result) throw new Error(`MCP ${name}: ${res.status} ${JSON.stringify(res.body)}`);
      return { isError: Boolean(result.isError), text: result.content[0]?.text ?? "" };
    });
}

async function mcpToken(app: Express, account: Account): Promise<string> {
  const res = await request(app)
    .post("/api/profile/api-token")
    .set(auth(account))
    .send({ mcp_tools: [...DEFAULT_MCP_TOOL_NAMES, "upload_model", "add_model_files"] });
  if (res.status !== 200) throw new Error(`api token: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

/** A model of the user's to add files to: one plate, Base.stl. */
async function baseModel(app: Express, account: Account, seed: string): Promise<string> {
  const res = await attachAll(request(app).post("/api/upload").set(auth(account)), { "Base.stl": null }, seed, "files");
  if (res.status !== 200) throw new Error(`base model: ${refusal(res)}`);
  return res.body.prints[0].id;
}

export type WayContext = {
  app: Express;
  /** Answers fetches for the current case: what a stubbed site or link serves. */
  serve(handler: FetchHandler): void;
};

/** The URL a case's link files are served at. */
const linkUrl = (seed: string, name: string) =>
  `https://downloads.example.com/${encodeURIComponent(seed)}/${name.split("/").map(encodeURIComponent).join("/")}`;

/** Serves the tree's files at their links. An index.html is a page linking the others, in the tree's order. */
async function serveFiles(ctx: WayContext, tree: FileTree, seed: string) {
  const files = await filesOf(tree, seed);
  const byUrl = new Map(files.map((file) => [linkUrl(seed, file.path), file]));
  const page = `<html><body>${files
    .filter((file) => file.path !== "index.html")
    .map((file) => `<a href="${linkUrl(seed, file.path)}">${file.path}</a>`)
    .join(" ")}</body></html>`;
  ctx.serve((call) => {
    const file = byUrl.get(call.url.href);
    if (!file) return undefined;
    return file.path === "index.html" ? html(page) : binary(file.bytes);
  });
}

/** The Thing a site case imports: its files are the case's, listed as Thingiverse lists a Thing's files. */
export const THINGIVERSE_TOKEN = "intake-access-token";
let things = 0;

async function serveThing(ctx: WayContext, tree: FileTree, seed: string): Promise<string> {
  const thingId = String(9_400_000 + things++);
  const cdn = (name: string) => `https://cdn.thingiverse.com/assets/intake/${thingId}/${encodeURIComponent(name)}`;
  const files = await filesOf(tree, seed);
  const detail = {
    id: Number(thingId),
    name: "Thing",
    description: "A Thing for the intake cases.",
    tags: [],
    thumbnail: `https://cdn.thingiverse.com/renders/intake/${thingId}/thumb.png`,
    default_image: { url: `https://cdn.thingiverse.com/renders/intake/${thingId}/cover.png` },
    categories_url: `https://api.thingiverse.com/things/${thingId}/categories`,
    creator: { id: 77, name: "IntakeCreator", public_url: "https://www.thingiverse.com/IntakeCreator" },
    zip_data: {
      files: files.map((file) => ({ name: path.basename(file.path), url: cdn(path.basename(file.path)) })),
      images: [{ name: "render.png", url: `https://cdn.thingiverse.com/renders/intake/${thingId}/render.png` }],
    },
  };
  const bytes = new Map(files.map((file) => [cdn(path.basename(file.path)), file.bytes]));
  ctx.serve((call) => {
    const url = call.url.href;
    if (url.startsWith(`https://api.thingiverse.com/things/${thingId}/categories`)) return json([]);
    if (url.startsWith(`https://api.thingiverse.com/things/${thingId}`)) return json(detail);
    const file = bytes.get(url);
    return file ? binary(file) : undefined;
  });
  return `https://www.thingiverse.com/thing:${thingId}`;
}

async function importLink(ctx: WayContext, account: Account, url: string) {
  return request(ctx.app).post("/api/import").set(auth(account)).send({ url });
}

async function waitForJob(jobId: string) {
  for (let i = 0; i < 500; i++) {
    const job = await prisma.importJob.findUnique({ where: { id: jobId } });
    if (job && job.status !== "RUNNING" && job.status !== "QUEUED") return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`the import job ${jobId} did not finish`);
}

async function waitForRepair(ctx: WayContext, account: Account) {
  for (let i = 0; i < 500; i++) {
    const res = await request(ctx.app).get("/api/prints/repair/run").set(auth(account));
    if (!res.body.run?.running) return res.body.run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the repair did not finish");
}

/** Runs `tree` through `way` for a new user of its own, and reads back what it made. */
export async function runWay(ctx: WayContext, way: Way, tree: FileTree, seed: string): Promise<Outcome> {
  const { app } = ctx;
  const account = await register(app, seed);
  const made = () => modelsOf(account.id);
  const answer = async (res: { status: number; body: { detail?: string } }): Promise<Outcome> =>
    res.status === 200 || res.status === 202
      ? { models: await made() }
      : { refused: refusal(res), models: await made() };

  switch (way) {
    case "upload":
    case "upload-separate": {
      const req = request(app).post("/api/upload").set(auth(account));
      const count = (await filesOf(tree, seed)).length;
      if (way === "upload-separate") req.field("mode", "separate");
      else if (count > 1) req.field("mode", "multiplate");
      return answer(await attachAll(req, tree, seed, "files"));
    }

    case "mcp-upload": {
      const token = await mcpToken(app, account);
      const result = await mcpCall(app, token, "upload_model", { files: await base64Files(tree, seed) });
      return result.isError ? { refused: result.text, models: await made() } : { models: await made() };
    }

    case "consume-files":
    case "consume-folders": {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-intake-"));
      try {
        await setConsumeSettings({ mode: way === "consume-files" ? "separate" : "folder", userId: account.id });
        await writeTree(dir, tree, seed);
        await consumeFolder(dir);
        const left = listed(path.join(dir, NOT_IMPORTED_DIR));
        return { models: await made(), ...(left.length ? { left } : {}) };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    case "add-plates": {
      const id = await baseModel(app, account, seed);
      const res = await attachAll(request(app).post(`/api/print/${id}/plates`).set(auth(account)), tree, seed, "files");
      return answer(res);
    }

    case "add-file": {
      const id = await baseModel(app, account, seed);
      for (const file of await filesOf(tree, seed)) {
        const res = await request(app)
          .post(`/api/print/${id}/files`)
          .set(auth(account))
          .attach("file", file.bytes, { filename: path.basename(file.path) });
        if (res.status !== 200) return answer(res);
      }
      return { models: await made() };
    }

    case "mcp-add": {
      const id = await baseModel(app, account, seed);
      const token = await mcpToken(app, account);
      const result = await mcpCall(app, token, "add_model_files", {
        model_id: id,
        files: await base64Files(tree, seed),
      });
      return result.isError ? { refused: result.text, models: await made() } : { models: await made() };
    }

    case "link":
    case "zip-link": {
      await serveFiles(ctx, tree, seed);
      const [first] = Object.keys(tree);
      return answer(await importLink(ctx, account, linkUrl(seed, first)));
    }

    case "zip-entries": {
      await serveFiles(ctx, tree, seed);
      const url = linkUrl(seed, Object.keys(tree)[0]);
      const listedEntries = await request(app).post("/api/import/zip/entries").set(auth(account)).send({ url });
      if (listedEntries.status !== 200) return answer(listedEntries);
      // Every entry ticked, as Grab's "Choose files" sends them.
      const entries = (listedEntries.body.entries as { path: string }[]).map((entry) => entry.path);
      const started = await request(app).post("/api/import/zip").set(auth(account)).send({ url, entries });
      if (started.status !== 202) return answer(started);
      const job = await waitForJob(started.body.job_id);
      return {
        models: await made(),
        ...(job.failedCount ? { left: [`${job.failedCount} of ${entries.length} entries failed`] } : {}),
        ...(job.status === "ERROR" ? { refused: `job failed: ${job.errorMessage ?? ""}`.trim() } : {}),
      };
    }

    case "site": {
      const url = await serveThing(ctx, tree, seed);
      return answer(await importLink(ctx, account, url));
    }

    case "repair": {
      const url = await serveThing(ctx, tree, seed);
      const imported = await importLink(ctx, account, url);
      if (imported.status !== 200) return { refused: `import: ${refusal(imported)}`, models: await made() };
      const [print] = await prisma.print.findMany({ where: { userId: account.id }, include: { plates: true } });
      // The owner's own document beside the site's files, then every plate's file gone from the disk.
      const notes = await request(app)
        .post(`/api/print/${print.id}/files`)
        .set(auth(account))
        .attach("file", Buffer.from(`my notes ${seed}\n`), { filename: "My notes.txt" });
      if (notes.status !== 200) throw new Error(`notes: ${refusal(notes)}`);
      for (const plate of print.plates) fs.rmSync(path.join(STORAGE, plate.storagePath), { force: true });
      const started = await request(app).post("/api/prints/repair").set(auth(account)).send({ action: "reimport" });
      if (started.status !== 200) return answer(started);
      const run = await waitForRepair(ctx, account);
      return {
        models: await made(),
        ...(run.last_error ? { refused: `repair: ${run.last_error}` } : {}),
      };
    }

    case "copy": {
      const owner = await register(app, `${seed}-owner`);
      const req = request(app).post("/api/upload").set(auth(owner));
      if ((await filesOf(tree, seed)).length > 1) req.field("mode", "multiplate");
      const uploaded = await attachAll(req, tree, seed, "files");
      if (uploaded.status !== 200) return { refused: `upload: ${refusal(uploaded)}`, models: await made() };
      const id = uploaded.body.prints[0].id;
      const collection = await request(app)
        .post("/api/collections")
        .set(auth(owner))
        .send({ name: `Shared ${seed}`, is_public: true });
      await request(app).post(`/api/collection/${collection.body.id}/items/${id}`).set(auth(owner));
      return answer(await request(app).post(`/api/print/${id}/copy`).set(auth(account)));
    }
  }
}
