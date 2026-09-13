import { createApp } from "./app";
import { API_PORT } from "./config";
import { prisma } from "./db"; // also ensures storage directories exist before we start serving
import { normalizeAllTagCasing } from "./services/tagCasingBackfill";

const app = createApp();

// A job left RUNNING can only mean the previous process died mid-import (crash/redeploy) --
// there's no way anything is still working on it. Clear the lock on startup so an interrupted
// import doesn't wedge every future import behind it forever.
prisma.importJob
  .updateMany({
    where: { status: "RUNNING" },
    data: { status: "ERROR", errorMessage: "Interrupted by server restart" },
  })
  .catch((err) => console.error("Failed to recover stale import jobs on startup:", err));

// TEMPORARY: runs on every boot, no "already done" guard -- remove this call (and the now-unused
// import above) once this has run against prod after the next deploy. Awaited (unlike the
// stale-import-job cleanup above) so the app doesn't start serving requests against inconsistent
// tag casing, but a failure here still shouldn't block the app from starting at all, so it's
// caught and logged rather than left to crash the process.
normalizeAllTagCasing()
  .catch((err) => console.error("Tag casing backfill failed to run:", err))
  .finally(() => {
    app.listen(API_PORT, () => {
      console.log(`Thingport API listening on port ${API_PORT}`);
    });
  });
