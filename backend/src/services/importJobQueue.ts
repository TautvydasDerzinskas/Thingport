import { Prisma, type ImportJob } from "@prisma/client";
import type { ProviderId } from "../providers/index.generated";
import { prisma } from "../db";
import type { SingleImportBody } from "./singleImport";
import { batchPayload, type BatchType } from "./importJobPayload";
import { wakeImportScheduler } from "./importWorker";

export function storedImportBody(body: SingleImportBody): Prisma.InputJsonValue {
  const { makerworld_cookie: _cookie, ...stored } = body;
  return JSON.parse(JSON.stringify(stored)) as Prisma.InputJsonValue;
}

export async function enqueueSingleImport(
  userId: string,
  body: SingleImportBody,
  mcp?: { collectionId?: string },
): Promise<ImportJob> {
  const job = await prisma.importJob.create({
    data: {
      userId,
      type: "SINGLE",
      status: "QUEUED",
      sourceUrl: body.url,
      total: 1,
      payload: storedImportBody({ ...body, ...(mcp ? { mcp } : {}) }),
    },
  });
  wakeImportScheduler();
  return job;
}

export async function enqueueLinksImport(
  userId: string,
  urls: string[],
  payload: Prisma.InputJsonValue,
): Promise<ImportJob> {
  // Items and readiness become visible together, so no worker can finish a half-created job.
  const job = await prisma.importJob.create({
    data: {
      userId,
      type: "LINKS",
      status: "QUEUED",
      sourceUrl: urls[0],
      total: urls.length,
      payload,
      items: { create: urls.map((url) => ({ url })) },
    },
  });
  wakeImportScheduler();
  return job;
}

export async function enqueueBatchImport(
  userId: string,
  type: BatchType,
  body: unknown,
  provider?: ProviderId,
): Promise<ImportJob> {
  const payload = batchPayload(type, body);
  const total = "model_ids" in payload ? payload.model_ids.length : "entries" in payload ? payload.entries.length : 0;
  const job = await prisma.importJob.create({
    data: {
      userId,
      type,
      status: "QUEUED",
      sourceUrl: payload.url,
      provider,
      total,
      payload: JSON.parse(JSON.stringify(payload)),
    },
  });
  wakeImportScheduler();
  return job;
}
