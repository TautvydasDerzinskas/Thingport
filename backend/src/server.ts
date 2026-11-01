import { createApp } from "./app";
import { API_PORT } from "./config";
import "./db"; // ensures storage directories exist before we start serving
import { startConsumeWatcher } from "./services/consumeService";
import { startCollectionSyncScheduler } from "./services/collectionSyncRunner";
import {
  holdImportWorker,
  recoverImportJobs,
  startImportWorker,
  startImportWorkerAfterRecovery,
} from "./services/importWorker";
import { seedFlaresolverrUrl, seedPublicUrl } from "./services/settingsService";
import { startNotificationCleanup } from "./services/notificationService";
import { startSystemNotificationSync } from "./services/systemNotificationService";
import { announceVersionUpdate } from "./services/releaseNotesService";
import { resumeStorageMove } from "./services/storageMoveService";
import { resumeFileReuseBackfill } from "./services/fileReuseBackfill";
import { seedProviderCategoryIds } from "./services/categorySiteIds";

const app = createApp();

// Nothing is claimed until what the last process left RUNNING is settled, or a job just claimed would be taken for one.
holdImportWorker();
const bootedAt = new Date();

seedFlaresolverrUrl().catch((err) => console.error("Failed to seed the FlareSolverr URL setting:", err));
seedPublicUrl().catch((err) => console.error("Failed to seed the public URL setting:", err));
seedProviderCategoryIds().catch((err) => console.error("Failed to seed a new provider's starter category ids:", err));

async function boot(): Promise<void> {
  // Nothing can have started yet, so this takes all that's RUNNING. A machine without a clock battery can boot behind
  // the last thing it wrote, and "written before now" would leave that row RUNNING until the next restart.
  const recovered = await recoverImportJobs().then(
    () => true,
    (err) => {
      console.error("Failed to recover import jobs on startup:", err);
      return false;
    },
  );
  app.listen(API_PORT, () => {
    console.log(`Thingport API listening on port ${API_PORT}`);
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
  if (recovered) startImportWorker();
  else startImportWorkerAfterRecovery(bootedAt);
}

void boot();
