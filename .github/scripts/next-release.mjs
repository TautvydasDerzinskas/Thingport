// The next version and release notes semantic-release would give the project in the current folder, as a dry run. Run
// by .github/workflows/release-pr.yml, which sets up the checkout it reads, once per project: semantic-release-monorepo
// settles on a project's tags when it's imported, so one process can't do two.

import { writeFileSync } from "node:fs";
import semanticRelease from "semantic-release";

// Called a push, since for a pull request it stops before reading anything.
const env = { ...process.env, GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" };
const result = await semanticRelease({ dryRun: true }, { env });
const { version = null, notes = "" } = result ? result.nextRelease : {};
writeFileSync(process.argv[2], JSON.stringify({ version, notes }));
