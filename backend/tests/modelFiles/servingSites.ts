import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll } from "vitest";
import { STORAGE } from "../../src/config";
import { prisma } from "../../src/db";
import { sendSharedFile } from "../../src/federation/publish";
import type { StorageSite } from "../../src/modelFiles/storageFs";
import { createPrint } from "../../src/services/printCreation";
import { saveFileFromTemp } from "../../src/services/printFileService";
import { getMcpAccess, getPreviewMode, setMcpAccess, setPreviewMode } from "../../src/services/settingsService";
import { asyncHandler } from "../../src/utils/asyncHandler";
import { track } from "../harness/lifecycle";
import { nonce, register, tempFile } from "../helpers/fileReuse";

// The sites that serve a model's stored file from the handle they open (src/utils/sendStored.ts), as cases the serving
// suites run alike: each makes a model with the kind of file it serves and asks for it as that site's client does.
// MCP's answers read as a download's: 200 with the bytes, 404 for "missing from storage", 500 for the server's error.

/** What a site answered. `size` is the size MCP says the file has. */
export type Answer = { status: number; body: Buffer; headers: Record<string, string | undefined>; size?: number };

/** A new model's file, as a case stored it. */
export type Stored = {
  printId: string;
  /** The row that names it. */
  row: { table: "plate" | "printFile"; id: string };
  /** Where it is, and what it holds. */
  abs: string;
  bytes: Buffer;
  /** Asks the site for it. */
  fetch: (headers?: Record<string, string>) => Promise<Answer>;
};

export type ServingCase = {
  name: string;
  site: StorageSite;
  /** What the site answers for a file that isn't there. */
  notFound: string;
  make: () => Promise<Stored>;
};

const ROUTE_404 = JSON.stringify({ detail: "Not found" });
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** The whole answer, as bytes, whatever its type. */
function bytesOf(req: request.Test): Promise<Answer> {
  return req
    .buffer(true)
    .parse((stream, done) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => done(null, Buffer.concat(chunks)));
    })
    .then((res) => ({ status: res.status, body: res.body as Buffer, headers: res.headers }));
}

/** Starts `op` now, tracked, so a test that ends with it parked at a pause still waits for it to unwind. */
export const start = <T>(op: () => PromiseLike<T>): Promise<T> => track(Promise.resolve().then(op));

/** Bytes as long as `bytes` but not the same: a file a size check couldn't tell from it. */
export const sameSizeAs = (bytes: Buffer): Buffer => crypto.randomBytes(bytes.length);

/** Puts `bytes` at `abs` by renaming a new file onto it, as a writer that replaces a file does. */
export function renameOnto(abs: string, bytes: Buffer): void {
  const swap = `${abs}.swap-${nonce()}`;
  fs.writeFileSync(swap, bytes);
  fs.renameSync(swap, abs);
}

/** The row goes, and a new one of the model's names the same path, with other bytes there. */
export async function giveAwayPath(stored: Stored): Promise<void> {
  const storagePath = path.relative(STORAGE, stored.abs);
  const bytes = sameSizeAs(stored.bytes);
  if (stored.row.table === "plate") {
    const plate = await prisma.plate.delete({ where: { id: stored.row.id } });
    await prisma.plate.create({
      data: { printId: plate.printId, position: plate.position, filename: "Other.stl", mime: plate.mime, storagePath },
    });
  } else {
    const file = await prisma.printFile.delete({ where: { id: stored.row.id } });
    const taker = await prisma.printFile.create({
      data: { printId: file.printId, role: file.role, filename: file.filename, mime: file.mime, storagePath },
    });
    // A prepared print's place is taken with it.
    if (file.role === "PREPARED")
      await prisma.print.update({ where: { id: file.printId }, data: { preparedFileId: taker.id } });
  }
  renameOnto(stored.abs, bytes);
}

/** The file and its row move to another path, as a storage move does. */
export async function moveRow(stored: Stored): Promise<void> {
  const moved = path.join(path.dirname(stored.abs), `Moved ${nonce()}${path.extname(stored.abs)}`);
  fs.renameSync(stored.abs, moved);
  const storagePath = path.relative(STORAGE, moved);
  if (stored.row.table === "plate") await prisma.plate.update({ where: { id: stored.row.id }, data: { storagePath } });
  else await prisma.printFile.update({ where: { id: stored.row.id }, data: { storagePath } });
}

/** The row that names the file goes; the file stays. */
export async function dropRow(stored: Stored): Promise<void> {
  if (stored.row.table === "plate") await prisma.plate.delete({ where: { id: stored.row.id } });
  else await prisma.printFile.delete({ where: { id: stored.row.id } });
}

/** One user's models for every serving site. Previews are off, so nothing reads or writes a model's files after its
 *  request; MCP is on for reading; and each model is in a public collection, so partners may download it. */
export function useServingSites(app: Express, label: string): ServingCase[] {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `thingport-${label}-`));
  // A partner's download as federation/apRoutes.ts routes it, less the check that a partner signed the request.
  const partner = express().get(
    "/files/:kind/:id",
    asyncHandler((req, res) => sendSharedFile(res, req.params.kind, req.params.id)),
  );
  let owner: { id: string; token: string };
  let apiToken: string;
  let collectionId: string;
  let previews: Awaited<ReturnType<typeof getPreviewMode>>;
  let mcpAccess: Awaited<ReturnType<typeof getMcpAccess>>;

  beforeAll(async () => {
    previews = await getPreviewMode();
    mcpAccess = await getMcpAccess();
    await setPreviewMode("disabled");
    if (mcpAccess === "off") await setMcpAccess("read");
    owner = await register(app, label, "Owner");
    apiToken = (await request(app).post("/api/profile/api-token").set(auth(owner.token)).send({})).body.token;
    const name = `${label} ${nonce()}`;
    collectionId = (
      await prisma.collection.create({
        data: { userId: owner.id, name, nameNormalized: name.toLowerCase(), visibility: "PUBLIC" },
      })
    ).id;
  });

  afterAll(async () => {
    await setPreviewMode(previews);
    await setMcpAccess(mcpAccess);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** A new model with a plate, and the file of `kind` when it isn't the plate. */
  async function model(kind: "plate" | "supporting" | "prepared") {
    const plateBytes = Buffer.from(`solid ${nonce()}\nendsolid\n`);
    const { print, plates } = await createPrint(
      owner.id,
      { title: `${label} ${nonce()}` },
      label,
      [{ filename: "Part.stl", tempFilePath: tempFile(tmp, plateBytes) }],
      { describe: false, classify: false },
    );
    await prisma.collectionItem.create({ data: { collectionId, printId: print.id } });
    if (kind === "plate") {
      const [plate] = plates;
      return {
        printId: print.id,
        row: { table: "plate" as const, id: plate.id },
        abs: path.join(STORAGE, plate.storagePath),
        bytes: plateBytes,
      };
    }
    const filename = kind === "prepared" ? "Part.gcode" : "Guide.txt";
    const bytes = Buffer.from(kind === "prepared" ? `; ${nonce()}\nG1 X1 Y1\n` : `Guide ${nonce()}\n`);
    await saveFileFromTemp(owner.id, print.id, tempFile(tmp, bytes), filename, null);
    const file = await prisma.printFile.findFirstOrThrow({ where: { printId: print.id, filename } });
    if (kind === "prepared") {
      const { preparedFileId } = await prisma.print.findUniqueOrThrow({ where: { id: print.id } });
      if (preparedFileId !== file.id) throw new Error("The G-code didn't become the model's prepared print");
    }
    return {
      printId: print.id,
      row: { table: "printFile" as const, id: file.id },
      abs: path.join(STORAGE, file.storagePath),
      bytes,
    };
  }

  const get =
    (url: string) =>
    (headers: Record<string, string> = {}) =>
      bytesOf(request(app).get(url).set(auth(owner.token)).set(headers));

  async function viaMcp(printId: string, fileId: string): Promise<Answer> {
    const res = await request(app)
      .post("/api/mcp")
      .set(auth(apiToken))
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_model_file", arguments: { model_id: printId, file_id: fileId } },
      });
    const result = res.body.result as { isError?: boolean; content: { text: string }[] };
    const text = result.content[0]?.text ?? "";
    if (!result.isError) {
      const data = JSON.parse(text) as { base64: string; size_bytes: number };
      return { status: 200, body: Buffer.from(data.base64, "base64"), headers: {}, size: data.size_bytes };
    }
    const status = { "The file is missing from storage": 404, "Something went wrong on the server.": 500 }[text];
    return { status: status ?? 400, body: Buffer.from(text), headers: {} };
  }

  const viaPartner = (kind: "plate" | "file", id: string) => () =>
    bytesOf(request(partner).get(`/files/${kind}/${id}`));

  return [
    {
      name: "a plate's download",
      site: "serve.plate",
      notFound: ROUTE_404,
      async make() {
        const stored = await model("plate");
        return { ...stored, fetch: get(`/api/print/${stored.printId}/plate/${stored.row.id}/file/Part.stl`) };
      },
    },
    {
      name: "a plate's adapted link, for a plate no copy is made of",
      site: "serve.plate",
      notFound: ROUTE_404,
      async make() {
        const stored = await model("plate");
        const url = `/api/print/${stored.printId}/plate/${stored.row.id}/adapted/orcaslicer/Part.stl`;
        return { ...stored, fetch: get(url) };
      },
    },
    {
      name: "a supporting file's download",
      site: "serve.supporting",
      notFound: ROUTE_404,
      async make() {
        const stored = await model("supporting");
        return { ...stored, fetch: get(`/api/print/${stored.printId}/files/${stored.row.id}`) };
      },
    },
    {
      name: "the prepared print's download",
      site: "serve.prepared",
      notFound: ROUTE_404,
      async make() {
        const stored = await model("prepared");
        return { ...stored, fetch: get(`/api/print/${stored.printId}/prepared-print`) };
      },
    },
    ...(["plate", "supporting", "prepared"] as const).map((kind): ServingCase => ({
      name: `MCP's get_model_file, for a ${kind === "plate" ? "plate" : `${kind} file`}`,
      site: "mcp.file",
      notFound: "The file is missing from storage",
      async make() {
        const stored = await model(kind);
        return { ...stored, fetch: () => viaMcp(stored.printId, stored.row.id) };
      },
    })),
    ...(["plate", "supporting"] as const).map((kind): ServingCase => ({
      name: `a partner's download of a ${kind === "plate" ? "plate" : "file kept beside it"}`,
      site: "partner.file",
      notFound: JSON.stringify({ error: "Not found" }),
      async make() {
        const stored = await model(kind);
        return { ...stored, fetch: viaPartner(kind === "plate" ? "plate" : "file", stored.row.id) };
      },
    })),
  ];
}
