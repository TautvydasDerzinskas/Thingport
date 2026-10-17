import { createApp } from "./app";
import { API_PORT } from "./config";
import { prisma } from "./db"; // also ensures storage directories exist before we start serving
import { startConsumeWatcher } from "./services/consumeService";
import { startCollectionSyncScheduler } from "./services/collectionSyncRunner";
import { SYNC_JOB_INTERRUPTED } from "./services/importJobRunner";
import { seedFlaresolverrUrl, seedPublicUrl } from "./services/settingsService";
import { startNotificationCleanup } from "./services/notificationService";
import { startSystemNotificationSync } from "./services/systemNotificationService";
import { resumeStorageMove } from "./services/storageMoveService";

const app = createApp();

// A RUNNING job at startup means the previous process died mid-import; clear the lock. A sync's
// job is paused instead, for its next sync to pick up again.
(async () => {
  await prisma.importJob.updateMany({
    where: { status: "RUNNING", collectionSyncId: { not: null } },
    data: { status: "PAUSED", errorMessage: SYNC_JOB_INTERRUPTED },
  });
  await prisma.importJob.updateMany({
    where: { status: "RUNNING" },
    data: { status: "ERROR", errorMessage: "Interrupted by server restart" },
  });
})().catch((err) => console.error("Failed to recover stale import jobs on startup:", err));

seedFlaresolverrUrl().catch((err) => console.error("Failed to seed the FlareSolverr URL setting:", err));
seedPublicUrl().catch((err) => console.error("Failed to seed the public URL setting:", err));

app.listen(API_PORT, () => {
  console.log(`Thingport API listening on port ${API_PORT}`);
  startConsumeWatcher();
  startCollectionSyncScheduler();
  startNotificationCleanup();
  startSystemNotificationSync();
  resumeStorageMove().catch((err) => console.error("Failed to resume moving model files:", err));
});
