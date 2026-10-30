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

/** @typedef {{ number: number; title: string; url: string }} Issue */

/**
 * An issue as the site lists it, from the GitHub API's issues list, which has pull requests in it too: null for one.
 * Shared with the browser, which refreshes the list.
 * @param {any} item
 * @returns {Issue | null}
 */
export const listedIssue = (item) =>
  item && !item.pull_request && typeof item.number === "number" && typeof item.title === "string"
    ? { number: item.number, title: item.title, url: String(item.html_url) }
    : null;

/** @type {Map<string, Promise<Map<string, Issue[]> | null>>} */
const openIssues = new Map();

/**
 * A repo's open issues by label, fetched once per build: a request for every hundred, of which there are few, rather
 * than one per label asked about. Null when GitHub can't be reached; the browser fetches them then.
 * @param {string} repo
 */
function openIssuesByLabel(repo) {
  const issues =
    openIssues.get(repo) ??
    (async () => {
      /** @type {Map<string, Issue[]>} */
      const byLabel = new Map();
      // Ten pages is a thousand open issues: more than that, and what's missing is the oldest.
      for (let page = 1; page <= 10; page++) {
        const res = await fetch(`https://api.github.com/repos/${repo}/issues?state=open&per_page=100&page=${page}`, {
          headers: {
            Accept: "application/vnd.github+json",
            ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
          },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return null;
        const items = await res.json();
        if (!Array.isArray(items)) return null;
        for (const item of items) {
          const issue = listedIssue(item);
          if (!issue) continue;
          for (const { name } of item.labels ?? []) byLabel.set(name, [...(byLabel.get(name) ?? []), issue]);
        }
        if (!res.headers.get("link")?.includes('rel="next"')) break;
      }
      return byLabel;
    })().catch(() => null);
  openIssues.set(repo, issues);
  return issues;
}

/**
 * A repo's open issues with a label, newest first, fetched with the others once per build. GITHUB_TOKEN as for
 * starCount. Null when GitHub can't be reached.
 * @param {string} repo
 * @param {string} label
 */
export const openIssuesLabelled = async (repo, label) => {
  const byLabel = await openIssuesByLabel(repo);
  return byLabel && (byLabel.get(label) ?? []);
};
