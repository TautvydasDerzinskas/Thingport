import { Prisma } from "@prisma/client";
import { createApp } from "./app";
import { API_PORT } from "./config";
import { prisma } from "./db"; // also ensures storage directories exist before we start serving
import { startConsumeWatcher } from "./services/consumeService";
import { startCollectionSyncScheduler } from "./services/collectionSyncRunner";
import { SYNC_JOB_INTERRUPTED } from "./services/importJobRunner";
import { startImportScheduler } from "./services/importScheduler";
import { seedFlaresolverrUrl, seedPublicUrl } from "./services/settingsService";
import { startNotificationCleanup } from "./services/notificationService";
import { startSystemNotificationSync } from "./services/systemNotificationService";
import { announceVersionUpdate } from "./services/releaseNotesService";
import { resumeStorageMove } from "./services/storageMoveService";
import { resumeFileReuseBackfill } from "./services/fileReuseBackfill";
import { seedProviderCategoryIds } from "./services/categorySiteIds";

const app = createApp();

// A RUNNING job at startup means the previous process died mid-import; clear the lock. A sync's
// job is paused instead, for its next sync to pick up again.
(async () => {
  await prisma.importJob.updateMany({
    where: {
      payload: { equals: Prisma.DbNull },
      type: { notIn: ["SINGLE", "LINKS"] },
      status: "RUNNING",
      collectionSyncId: { not: null },
    },
    data: { status: "PAUSED", errorMessage: SYNC_JOB_INTERRUPTED },
  });
  await prisma.importJob.updateMany({
    where: { payload: { equals: Prisma.DbNull }, type: { notIn: ["SINGLE", "LINKS"] }, status: "RUNNING" },
    data: { status: "ERROR", errorMessage: "Interrupted by server restart" },
  });
})().catch((err) => console.error("Failed to recover stale import jobs on startup:", err));

seedFlaresolverrUrl().catch((err) => console.error("Failed to seed the FlareSolverr URL setting:", err));
seedPublicUrl().catch((err) => console.error("Failed to seed the public URL setting:", err));
seedProviderCategoryIds().catch((err) => console.error("Failed to seed a new provider's starter category ids:", err));

app.listen(API_PORT, () => {
  console.log(`Thingport API listening on port ${API_PORT}`);
  startImportScheduler();
  startConsumeWatcher();
  startCollectionSyncScheduler();
  startNotificationCleanup();
  startSystemNotificationSync();
  announceVersionUpdate().catch((err) => console.error("Failed to announce the version update:", err));
  resumeStorageMove()
    .catch((err) => console.error("Failed to resume moving model files:", err))
    // After, so it sees a move that's carrying on and waits for it.
    .then(() => resumeFileReuseBackfill())
    .catch((err) => console.error("Failed to resume checking identical files:", err));
});
