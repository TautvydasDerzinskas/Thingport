import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    env: { IMPORT_DOWNLOAD_RETRY_DELAY_MS: "0", PROFILE_FILL_AFTER_IMPORT_MS: "-1" },
    // Files share one database and mutate the same global rows, so parallel files race.
    fileParallelism: false,
  },
});
