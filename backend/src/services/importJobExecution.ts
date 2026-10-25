import type { ImportJob } from "@prisma/client";
import { isProviderId } from "../providers/index.generated";
import {
  enabledImportUrl,
  listImportSchema,
  profilesImportSchema,
  zipExtractRequestSchema,
} from "../routes/importRequest";
import { prisma } from "../db";
import { PROVIDERS, withLinkAuth } from "../providers/registry";
import { HttpError } from "../utils/fileUtils";
import {
  runLinksImportJob,
  runListImportJob,
  runZipImportJob,
  profilesImportJob,
  type LinksImportJobBody,
} from "./importJobRunner";
import { importAndDescribe, prepareSingleImport, type SingleImportBody } from "./singleImport";
import { addModelsToCollection, isSystemCollectionId } from "./collectionService";
import { batchPayload, type BatchType } from "./importJobPayload";

async function executeBatchImport(job: ImportJob): Promise<void> {
  const type = job.type as BatchType;
  const payload = batchPayload(type, job.payload);
  const url = await enabledImportUrl(job.sourceUrl);
  const body = await withLinkAuth<SingleImportBody>(job.userId, { ...payload, url });
  if (type === "ZIP") {
    await runZipImportJob(job.id, job.userId, zipExtractRequestSchema.parse(body));
    return;
  }
  if (!job.provider || !isProviderId(job.provider)) throw new HttpError(400, "Unknown import provider");
  const provider = job.provider;
  if (type === "PROFILES") {
    const run = profilesImportJob(provider);
    if (!run) throw new HttpError(400, "Provider cannot import print profiles");
    await run(job.id, job.userId, profilesImportSchema.parse(body));
    return;
  }
  const lists = PROVIDERS[provider].lists;
  if (!lists || lists.waitsForGrab) throw new HttpError(400, "This provider requires Thingport Grab");
  const listBody = listImportSchema
    .extend({ model_ids: lists.modelIds ?? listImportSchema.shape.model_ids })
    .parse(body);
  // Includes MakerWorld's own paced runner; rebuild its closure from fresh credentials here.
  const start = await lists.start(job.userId, url, listBody);
  if ("waitForGrab" in start) throw new HttpError(400, "This provider requires Thingport Grab");
  if ("run" in start) await start.run(job.id);
  else await runListImportJob(job.id, job.userId, provider, start.batch, listBody);
}

export async function executeQueuedImport(job: ImportJob): Promise<void> {
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  try {
    if (job.type === "COLLECTION" || job.type === "ZIP" || job.type === "PROFILES") {
      await executeBatchImport(job);
    } else if (job.type === "LINKS") {
      const body = await withLinkAuth<LinksImportJobBody>(job.userId, {
        url: job.sourceUrl,
        notes: typeof payload.notes === "string" ? payload.notes : null,
        tags: Array.isArray(payload.tags) ? (payload.tags as string[]) : [],
        category_id: typeof payload.category_id === "string" ? payload.category_id : null,
        scope: payload.scope === "designer" || payload.scope === "all" ? payload.scope : "url",
        itemDelayMs: typeof payload.item_delay_ms === "number" ? payload.item_delay_ms : undefined,
      });
      await runLinksImportJob(job.id, job.userId, body);
    } else {
      if (job.type !== "SINGLE") throw new HttpError(400, "Unsupported queued import type");
      const { url, body } = await prepareSingleImport(job.userId, {
        ...payload,
        url: job.sourceUrl,
      } as SingleImportBody);
      const mcp = payload.mcp as { collectionId?: string } | undefined;
      // Recheck ownership at execution: a queued collection can be removed before its turn.
      if (mcp?.collectionId) {
        if (isSystemCollectionId(mcp.collectionId))
          throw new HttpError(400, "Models can't be added to that collection");
        const owned = await prisma.collection.count({ where: { id: mcp.collectionId, userId: job.userId } });
        if (!owned) throw new HttpError(404, "Collection not found");
      }
      const result = await importAndDescribe(job.userId, url, body);
      const filed = mcp?.collectionId
        ? (await addModelsToCollection(job.userId, mcp.collectionId, [result.id])).collection
        : null;
      const taskResult = mcp
        ? { model: result, collection: filed ? { id: filed.id, name: filed.name } : null }
        : result;
      await prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: "DONE",
          processed: 1,
          imported: result.import_outcome === "already_imported" ? 0 : 1,
          alreadyInLibrary: result.import_outcome === "already_imported" ? 1 : 0,
          resultPrintId: result.id,
          result: JSON.parse(JSON.stringify(taskResult)),
        },
      });
    }
  } catch (err) {
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "ERROR",
        failedCount: job.type === "SINGLE" ? 1 : job.failedCount,
        processed: job.type === "SINGLE" ? 1 : job.processed,
        errorMessage: err instanceof HttpError ? err.message : "Internal server error",
        errorHttpStatus: err instanceof HttpError ? err.status : 500,
      },
    });
    console.error(`Queued import ${job.id} failed:`, err);
  }
}
