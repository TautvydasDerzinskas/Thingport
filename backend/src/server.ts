import { createApp } from "./app";
import { API_PORT } from "./config";
import { prisma } from "./db"; // also ensures storage directories exist before we start serving

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

app.listen(API_PORT, () => {
  console.log(`Thingport API listening on port ${API_PORT}`);
});
