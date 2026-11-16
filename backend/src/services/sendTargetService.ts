// Each user's Send to destinations: where a model's file goes from its page. A link the browser opens, with a
// short-lived link to just that file filled in; or a request Thingport's server makes, with the file or a link to it,
// through the same guard as a widget's requests: the local network is fine, a cloud metadata address isn't.

import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import type { Prisma } from "@prisma/client";
import { AUTH_SECRET } from "../config";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { readCapped } from "../utils/readCapped";
import { blockedByLookup, metadataHost, widgetDispatcher } from "./customWidgetsService";
import { buildImportSourceUrl } from "./importService";
import { resolvePlateFilePath } from "./printCreation";
import { managedPrintFilePath } from "./printFileService";
import {
  SEND_EXPORT_KIND,
  fillIn,
  requestOf,
  sendExportSchema,
  sendTargetInputSchema,
  splitSecrets,
  takesFile,
  testRequestOf,
  wantsFileUrl,
  type PlaceholderValues,
  type SendHow,
  type SendSecrets,
  type SendTargetInput,
} from "./sendTargetFormat";
import { readablePrintWhere } from "./socialService";

const MAX_TARGETS = 50;
const SEND_TIMEOUT_MS = 5 * 60 * 1000;
const TEST_TIMEOUT_MS = 15_000;
const ANSWER_MAX_BYTES = 64 * 1024;
const GRANT_TTL_SECONDS = 60 * 60;
/** The model page's own file: a plate's id, or this for the prepared print. */
export const PREPARED_FILE = "prepared";

type TargetRow = Prisma.SendTargetGetPayload<object>;

export type SendTargetOut = {
  id: string;
  name: string;
  placement: "button" | "menu";
  file_types: string[];
  how: SendHow;
  /** Which secrets are kept, never their values: a preset's API key, and secret headers by name. */
  secrets: { api_key: boolean; headers: string[] };
};

/** What the model page needs of one: its name, kind and where it shows. */
export type SendTargetSummary = {
  id: string;
  name: string;
  kind: SendHow["type"];
  preset: string | null;
  placement: "button" | "menu";
  file_types: string[];
  /** A link's tab, so the page can open it in the click itself, before the link comes back. */
  open: "new" | "named" | "same" | null;
  tab: string | null;
};

const secretsOf = (row: TargetRow) => (row.secrets as SendSecrets | null) ?? null;
const howOf = (row: TargetRow) => row.how as SendHow;

function out(row: TargetRow): SendTargetOut {
  const secrets = secretsOf(row);
  return {
    id: row.id,
    name: row.name,
    placement: row.placement === "button" ? "button" : "menu",
    file_types: row.fileTypes,
    how: howOf(row),
    secrets: { api_key: Boolean(secrets?.apiKey), headers: Object.keys(secrets?.headers ?? {}) },
  };
}

async function ownTarget(userId: string, id: string): Promise<TargetRow> {
  const row = await prisma.sendTarget.findFirst({ where: { id, userId } });
  if (!row) throw new HttpError(404, "No such destination");
  return row;
}

export async function listSendTargets(userId: string): Promise<SendTargetOut[]> {
  const rows = await prisma.sendTarget.findMany({
    where: { userId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(out);
}

export async function sendTargetSummaries(userId: string): Promise<SendTargetSummary[]> {
  return (await listSendTargets(userId)).map((target) => ({
    id: target.id,
    name: target.name,
    kind: target.how.type,
    preset: target.how.type === "preset" ? target.how.preset : null,
    placement: target.placement,
    file_types: target.file_types,
    open: target.how.type === "link" ? target.how.open : null,
    tab: target.how.type === "link" && target.how.open === "named" ? target.how.tab || "thingport" : null,
  }));
}

function rowData(input: SendTargetInput, previous: SendSecrets | null) {
  const { how, secrets } = splitSecrets(input, previous);
  return {
    name: input.name,
    placement: input.placement,
    fileTypes: input.fileTypes,
    how: how as Prisma.InputJsonValue,
    secrets: Object.keys(secrets).length ? (secrets as Prisma.InputJsonValue) : ({} as Prisma.InputJsonValue),
  };
}

export async function createSendTarget(userId: string, input: SendTargetInput): Promise<SendTargetOut> {
  const count = await prisma.sendTarget.count({ where: { userId } });
  if (count >= MAX_TARGETS) throw new HttpError(413, `${MAX_TARGETS} destinations at most`);
  const row = await prisma.sendTarget.create({ data: { userId, position: count, ...rowData(input, null) } });
  return out(row);
}

export async function updateSendTarget(userId: string, id: string, input: SendTargetInput): Promise<SendTargetOut> {
  const current = await ownTarget(userId, id);
  const row = await prisma.sendTarget.update({ where: { id: current.id }, data: rowData(input, secretsOf(current)) });
  return out(row);
}

export async function deleteSendTarget(userId: string, id: string): Promise<void> {
  const current = await ownTarget(userId, id);
  await prisma.sendTarget.delete({ where: { id: current.id } });
}

/** The user's destinations as a file to share: never a secret, so an API key stays with its owner. */
export async function exportSendTargets(userId: string) {
  const targets = await listSendTargets(userId);
  return {
    kind: SEND_EXPORT_KIND,
    version: 1 as const,
    targets: targets.map((target) => ({
      name: target.name,
      placement: target.placement,
      fileTypes: target.file_types,
      how: target.how,
    })),
  };
}

/** Adds what an export holds, after the user's own; their secrets are theirs to fill in. */
export async function importSendTargets(userId: string, raw: unknown): Promise<SendTargetOut[]> {
  const parsed = sendExportSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "That isn't a Send to file Thingport exported");
  const count = await prisma.sendTarget.count({ where: { userId } });
  if (count + parsed.data.targets.length > MAX_TARGETS)
    throw new HttpError(413, `${MAX_TARGETS} destinations at most; remove some first`);
  await prisma.$transaction(
    parsed.data.targets.map((target, index) =>
      prisma.sendTarget.create({
        data: { userId, position: count + index, ...rowData(sendTargetInputSchema.parse(target), null) },
      }),
    ),
  );
  return listSendTargets(userId);
}

// --- The file -------------------------------------------------------------------------------------------------------

type FileToSend = {
  path: string;
  filename: string;
  mime: string;
  kind: "plate" | "prepared";
  plateId: string | null;
  print: { id: string; name: string; sourceUrl: string | null };
};

/** One of the model's files the user may read: a plate, or the prepared print. */
async function fileToSend(userId: string, printId: string, fileKey: string): Promise<FileToSend> {
  const print = await prisma.print.findFirst({
    where: { AND: [{ id: printId }, await readablePrintWhere(userId)] },
    select: { id: true, name: true, title: true, sourceProvider: true, sourceExternalId: true, preparedFileId: true },
  });
  if (!print) throw new HttpError(404, "No such model");
  const model = {
    id: print.id,
    name: print.title || print.name,
    sourceUrl: buildImportSourceUrl(print.sourceProvider, print.sourceExternalId),
  };
  if (fileKey === PREPARED_FILE) {
    const record = print.preparedFileId
      ? await prisma.printFile.findUnique({ where: { id: print.preparedFileId } })
      : null;
    if (!record || record.printId !== print.id || record.role !== "PREPARED") throw new HttpError(404, "No such file");
    const filePath = managedPrintFilePath(record);
    if (!fs.existsSync(filePath)) throw new HttpError(404, "No such file");
    const mime = record.mime || "application/octet-stream";
    return { path: filePath, filename: record.filename, mime, kind: "prepared", plateId: null, print: model };
  }
  const plate = await prisma.plate.findFirst({ where: { id: fileKey, printId: print.id } });
  const filePath = plate ? resolvePlateFilePath(plate) : null;
  if (!plate || !filePath || !fs.existsSync(filePath)) throw new HttpError(404, "No such file");
  const mime = plate.mime || "application/octet-stream";
  return { path: filePath, filename: plate.filename, mime, kind: "plate", plateId: plate.id, print: model };
}

// A link to one file, for an hour, that needs no sign-in: what a link or a webhook hands on. Signed with a key of its
// own, so it can never pass for a session token, and naming the one file, so it opens nothing else.
const grantKey = createHmac("sha256", AUTH_SECRET).update("thingport:send-to-file-link").digest();
const base64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");
const signGrant = (payload: string) => base64url(createHmac("sha256", grantKey).update(payload).digest());

export function makeFileGrant(userId: string, printId: string, fileKey: string, now = Date.now()): string {
  const payload = base64url(
    JSON.stringify({ u: userId, p: printId, f: fileKey, e: Math.floor(now / 1000) + GRANT_TTL_SECONDS }),
  );
  return `${payload}.${signGrant(payload)}`;
}

export function readFileGrant(
  grant: string,
  now = Date.now(),
): { userId: string; printId: string; fileKey: string } | null {
  const [payload, signature, extra] = grant.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(signGrant(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { u, p, f, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof u !== "string" || typeof p !== "string" || typeof f !== "string" || typeof e !== "number") return null;
    if (e * 1000 < now) return null;
    return { userId: u, printId: p, fileKey: f };
  } catch {
    return null;
  }
}

/** The file a link names, while its user may still read it. */
export async function fileFromGrant(grant: string): Promise<{ path: string; filename: string; mime: string }> {
  const granted = readFileGrant(grant);
  const user = granted ? await prisma.user.findUnique({ where: { id: granted.userId }, select: { id: true } }) : null;
  if (!granted || !user) throw new HttpError(404, "Not found");
  const file = await fileToSend(user.id, granted.printId, granted.fileKey).catch(() => null);
  if (!file) throw new HttpError(404, "Not found");
  return file;
}

function fileUrlOf(origin: string, userId: string, file: FileToSend): string {
  const grant = makeFileGrant(userId, file.print.id, file.plateId ?? PREPARED_FILE);
  return `${origin}/api/send-file/${grant}/${encodeURIComponent(file.filename)}`;
}

// --- Sending --------------------------------------------------------------------------------------------------------

/** Why it didn't go, for the page to say in the user's language. */
export type SendReason =
  | "auth"
  | "not_found"
  | "conflict"
  | "too_large"
  | "unsupported"
  | "redirect"
  | "http"
  | "timeout"
  | "unreachable"
  | "blocked";

export type SendOutcome = { ok: true; status: number } | { ok: false; reason: SendReason; status?: number };

function outcomeOf(status: number): SendOutcome {
  if (status >= 200 && status < 300) return { ok: true, status };
  const reason: SendReason =
    status >= 300 && status < 400
      ? "redirect"
      : status === 401 || status === 403
        ? "auth"
        : status === 404
          ? "not_found"
          : status === 409
            ? "conflict"
            : status === 413
              ? "too_large"
              : status === 415
                ? "unsupported"
                : "http";
  return { ok: false, reason, status };
}

/** A request to a destination, through the widgets' guard: never redirected, never to a metadata address. */
async function reach(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: RequestInit["body"] },
  timeoutMs: number,
): Promise<SendOutcome> {
  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:") return { ok: false, reason: "blocked" };
  if (metadataHost(target.hostname)) return { ok: false, reason: "blocked" };
  try {
    const res = await fetch(target, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      dispatcher: widgetDispatcher,
    } as RequestInit);
    // Read a little of the answer, so the connection is done with; what it says isn't shown.
    await readCapped(res, ANSWER_MAX_BYTES).catch(() => undefined);
    return outcomeOf(res.status);
  } catch (err) {
    if (blockedByLookup(err)) return { ok: false, reason: "blocked" };
    const name = (err as { name?: string } | null)?.name;
    return { ok: false, reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "unreachable" };
  }
}

export type SendResult =
  | { open: { url: string; mode: "new" | "named" | "same"; tab: string | null } }
  | (SendOutcome & {
      then_open?: string;
    });

/** Sends a model's file to one of the user's destinations: a link to open, or what the server's request came to.
 *  `origin` is the instance's own address, for the file's link. */
export async function sendToTarget(
  user: { id: string; displayName: string },
  printId: string,
  fileKey: string,
  targetId: string,
  origin: string,
): Promise<SendResult> {
  const target = await ownTarget(user.id, targetId);
  const how = howOf(target);
  const file = await fileToSend(user.id, printId, fileKey);
  if (!takesFile(target.fileTypes, file.filename)) throw new HttpError(400, "This destination doesn't take that file");
  const request = how.type === "link" ? null : requestOf(how, secretsOf(target));
  const linkWanted =
    how.type === "link"
      ? wantsFileUrl(how.url)
      : request!.body === "json" || wantsFileUrl(request!.url, request!.thenOpen);
  const values: PlaceholderValues = {
    file_url: linkWanted ? fileUrlOf(origin, user.id, file) : "",
    filename: file.filename,
    model_id: file.print.id,
    model_name: file.print.name,
    model_url: `${origin}/models/${file.print.id}`,
    plate_id: file.plateId ?? "",
    source_url: file.print.sourceUrl ?? "",
  };

  if (how.type === "link") {
    const mode = how.open;
    return { open: { url: fillIn(how.url, values), mode, tab: mode === "named" ? how.tab || "thingport" : null } };
  }

  const req = request!;
  const headers = Object.fromEntries(req.headers.map((header) => [header.name, header.value]));
  let body: RequestInit["body"];
  if (req.body === "json") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({
      event: "thingport.send",
      file_url: values.file_url,
      filename: file.filename,
      file_kind: file.kind,
      plate_id: file.plateId,
      model: { id: file.print.id, name: file.print.name, url: values.model_url, source_url: file.print.sourceUrl },
      sent_by: user.displayName,
      sent_at: new Date().toISOString(),
    });
  } else {
    const blob = await fs.openAsBlob(file.path, { type: file.mime });
    if (req.body === "raw") {
      headers["Content-Type"] = "application/octet-stream";
      body = blob;
    } else {
      const form = new FormData();
      for (const field of req.fields) form.append(field.name, fillIn(field.value, values, false));
      form.append(req.fileField, blob, file.filename);
      body = form;
    }
  }
  const result = await reach(fillIn(req.url, values), { method: req.method, headers, body }, SEND_TIMEOUT_MS);
  return result.ok && req.thenOpen ? { ...result, then_open: fillIn(req.thenOpen, values) } : result;
}

/** Whether a destination answers, without sending a file: a printer's version, a webhook's test event, or a custom
 *  request's host. A link has nothing to reach. */
export async function testSendTarget(userId: string, targetId: string): Promise<SendOutcome> {
  const target = await ownTarget(userId, targetId);
  const how = howOf(target);
  if (how.type === "link") throw new HttpError(400, "A link has nothing to test");
  const test = testRequestOf(how, secretsOf(target));
  const headers = Object.fromEntries(test.headers.map((header) => [header.name, header.value]));
  if (test.json) headers["Content-Type"] = "application/json";
  const result = await reach(
    test.url,
    { method: test.method, headers, body: test.json ? JSON.stringify(test.json) : undefined },
    TEST_TIMEOUT_MS,
  );
  // A custom request's host answering at all is all a test can say about it.
  if (how.type === "request" && !result.ok && result.status !== undefined && result.reason !== "auth")
    return { ok: true, status: result.status };
  return result;
}
