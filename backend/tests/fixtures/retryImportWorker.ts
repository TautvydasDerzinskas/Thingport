import { prisma } from "../../src/db";
import { startLinksJob } from "../../src/services/importQueueService";
import { HttpError } from "../../src/utils/fileUtils";

async function retry() {
  try {
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: process.argv[2] } });
    await startLinksJob(job, { retryFailed: true });
    process.stdout.write("queued\n");
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    process.stdout.write(`${err.status}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void retry().then(() => process.exit(0));
