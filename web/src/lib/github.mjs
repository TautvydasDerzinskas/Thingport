// No imports: the browser's copy of formatStars would bring them along.

/** @type {Map<string, Promise<number | null>>} */
const counts = new Map();

/**
 * A repo's (`owner/name`) star count, fetched once per build. GITHUB_TOKEN, when set (CI), lifts the API's anonymous
 * rate limit. Null when GitHub can't be reached: the GitHub link then shows no count, and the browser fills it in.
 * @param {string} repo
 */
export function starCount(repo) {
  const count =
    counts.get(repo) ??
    fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
      },
      signal: AbortSignal.timeout(5000),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (typeof data?.stargazers_count === "number" ? data.stargazers_count : null))
      .catch(() => null);
  counts.set(repo, count);
  return count;
}

/** 999, 1.2k, 12k. Shared with the browser, which refreshes the count. */
export const formatStars = (/** @type {number} */ count) =>
  count < 1000 ? String(count) : `${(count / 1000).toFixed(count < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
