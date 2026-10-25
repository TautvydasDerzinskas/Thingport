import { once } from "node:events";
import { prisma } from "../../src/db";
import { drainImportQueue } from "../../src/services/importScheduler";

// Pause after the real claim commits, before any provider request. Killing the dedicated
// PostgreSQL session must terminate this process, not just change an in-memory flag.
prisma.$use(async (params, next) => {
  const result = await next(params);
  if (params.model === "ImportJob" && params.action === "updateMany" && params.args.data.status === "RUNNING") {
    process.stdout.write("CLAIMED\n");
    await new Promise(() => undefined);
  }
  if (process.argv.includes("--idle") && params.model === "ImportJob" && params.action === "findFirst") {
    process.stdout.write("IDLE\n");
    await once(process.stdin, "data");
  }
  return result;
});
void drainImportQueue().then(() => process.exit(0));
