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
import { recoverMigrations } from "./services/migrate/runs";
import { resumeFileReuseBackfill } from "./services/fileReuseBackfill";
import { seedProviderCategoryIds } from "./services/categorySiteIds";
import { linkUnattributedPrints } from "./services/authorService";
import { startDeliveryWorker } from "./federation/delivery";
import { startLinks } from "./federation/links";
import { getFederationSettings } from "./federation/settings";

const app = createApp();

// Nothing is claimed until what the last process left RUNNING is settled, or a job just claimed would be taken for one.
holdImportWorker();
const bootedAt = new Date();

seedFlaresolverrUrl().catch((err) => console.error("Failed to seed the FlareSolverr URL setting:", err));
seedPublicUrl().catch((err) => console.error("Failed to seed the public URL setting:", err));
seedProviderCategoryIds().catch((err) => console.error("Failed to seed a new provider's starter category ids:", err));
// Name-only models get the author another import has since saved, where only one fits. Nothing is fetched.
linkUnattributedPrints().catch((err) => console.error("Failed to link models to their authors:", err));

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
  const server = app.listen(API_PORT, () => {
    console.log(`Thingport API listening on port ${API_PORT}`);
    startConsumeWatcher();
    startCollectionSyncScheduler();
    startNotificationCleanup();
    startSystemNotificationSync();
    // Only where an admin turned connected instances on; elsewhere Fedify is never even loaded.
    getFederationSettings()
      .then((settings) => {
        if (!settings.enabled) return;
        startDeliveryWorker();
        startLinks();
      })
      .catch((err) => console.error("Failed to start connected instances:", err));
    announceVersionUpdate().catch((err) => console.error("Failed to announce the version update:", err));
    recoverMigrations().catch((err) => console.error("Failed to settle the migrations the last run left:", err));
    resumeStorageMove()
      .catch((err) => console.error("Failed to resume moving model files:", err))
      // After, so it sees a move that's carrying on and waits for it.
      .then(() => resumeFileReuseBackfill())
      .catch((err) => console.error("Failed to resume checking identical files:", err));
  });
  // A whole request may take up to an hour: a partner's file coming up its link, or a big upload, on a slow
  // connection. Headers still have to arrive within a minute (headersTimeout), and nginx in front has its own limits.
  server.requestTimeout = 60 * 60 * 1000;
  if (recovered) startImportWorker();
  else startImportWorkerAfterRecovery(bootedAt);
}

void boot();
