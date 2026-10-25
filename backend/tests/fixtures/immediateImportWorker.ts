import { once } from "node:events";
import { startImmediateImport } from "../../src/services/immediateImport";

void startImmediateImport(
  {
    userId: process.argv[2],
    type: "LINKS",
    status: "RUNNING",
    sourceUrl: "https://example.com/immediate",
    payload: { immediate: true },
    items: { create: [{ url: "https://example.com/immediate", status: "RUNNING" }] },
  },
  async (id) => {
    process.stdout.write(`${id}\n`);
    await once(process.stdin, "data");
  },
);
