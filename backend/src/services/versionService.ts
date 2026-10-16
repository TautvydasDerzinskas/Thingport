import fs from "node:fs";
import path from "node:path";

const GITHUB_REPO = "TautvydasDerzinskas/Thingport";

export type VersionCheckResult = {
  backend_version: string | null;
  backend_sha: string | null;
  latest_backend_sha: string | null;
  latest_frontend_sha: string | null;
};

// Set by the Dockerfile's GIT_SHA build arg; null in dev, which the UI treats as "can't check".
export function getBackendGitSha(): string | null {
  return process.env.GIT_SHA && process.env.GIT_SHA !== "unknown" ? process.env.GIT_SHA : null;
}

// From package.json, which each release bumps; the server runs from its own folder, in Docker and in dev alike.
let backendVersion: string | null | undefined;
export function getBackendVersion(): string | null {
  if (backendVersion === undefined) {
    try {
      const { version } = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as { version?: string };
      backendVersion = version ?? null;
    } catch {
      backendVersion = null;
    }
  }
  return backendVersion;
}

// The head_sha of the latest successful image workflow run. A path filter would miss commits that
// republish the image via the shared build-image.yml without touching the project itself.
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
  return {
    backend_version: getBackendVersion(),
    backend_sha: getBackendGitSha(),
    latest_backend_sha,
    latest_frontend_sha,
  };
}
