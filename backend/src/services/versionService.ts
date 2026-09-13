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

// backend-image.yml / frontend-image.yml only rebuild+publish an image when a commit actually
// touches that project's own directory (path filters), so the commit that matters for "is the
// published image stale" is the most recent one touching backend/ or frontend/ on main -- not
// main's raw HEAD, which may have moved for unrelated reasons (docs, the other project, CI
// config) without a new image ever being built.
async function latestCommitTouching(path: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/commits?path=${path}&sha=main&per_page=1`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!res.ok) return null;
    const commits = (await res.json()) as Array<{ sha: string }>;
    return commits[0]?.sha ?? null;
  } catch {
    return null;
  }
}

export async function checkForUpdates(): Promise<VersionCheckResult> {
  const [latest_backend_sha, latest_frontend_sha] = await Promise.all([
    latestCommitTouching("backend"),
    latestCommitTouching("frontend"),
  ]);
  return { backend_sha: getBackendGitSha(), latest_backend_sha, latest_frontend_sha };
}
