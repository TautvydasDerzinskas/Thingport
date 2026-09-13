const GITHUB_REPO = "TautvydasDerzinskas/Thingport";

export type VersionCheckResult = {
  backend_sha: string | null;
  latest_backend_sha: string | null;
  latest_frontend_sha: string | null;
};

// Baked into the image at build time (see backend/Dockerfile's GIT_SHA build arg, set by
// .github/workflows/build-image.yml) -- null for a local `npm run dev` / hand-built image with
// no --build-arg, which the admin settings UI treats as "can't check" rather than as outdated.
export function getBackendGitSha(): string | null {
  return process.env.GIT_SHA && process.env.GIT_SHA !== "unknown" ? process.env.GIT_SHA : null;
}

// The commit that actually produced the currently published `:latest` image -- i.e. the head_sha
// of the most recent successful, push-triggered run of that project's own image workflow. This
// asks CI directly what it last published rather than guessing from a path filter: backend-
// image.yml also republishes on a change to the *shared* build-image.yml (its own `paths:` list
// includes that file), so a commit that only touches CI config or the other project can still be
// the one baked into a freshly-published image, without ever having touched backend/ or
// frontend/ itself -- a path-filtered "latest commit touching backend/" query would miss exactly
// that commit and report a stale, unrelated SHA as "latest" (a real false positive this project
// hit: see commit 33e6114, which only touched build-image.yml and frontend/package.json but
// still triggered a fresh backend image publish).
async function latestPublishedSha(workflowFile: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${workflowFile}/runs` +
        "?branch=main&event=push&status=success&per_page=1",
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { workflow_runs: Array<{ head_sha: string }> };
    return data.workflow_runs[0]?.head_sha ?? null;
  } catch {
    return null;
  }
}

export async function checkForUpdates(): Promise<VersionCheckResult> {
  const [latest_backend_sha, latest_frontend_sha] = await Promise.all([
    latestPublishedSha("backend-image.yml"),
    latestPublishedSha("frontend-image.yml"),
  ]);
  return { backend_sha: getBackendGitSha(), latest_backend_sha, latest_frontend_sha };
}
