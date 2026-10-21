import { z } from "zod";
import { prisma } from "../db";
import { RELEASE_NOTES_URL } from "../config";
import { compareVersions } from "./systemNotificationService";
import { GITHUB_REPO, getBackendVersion } from "./versionService";

const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 30 * 60 * 1000;
// Someone skipping many releases gets the most recent ones, not a wall of every fix since.
const MAX_VERSIONS = 5;
const LAST_RUN_VERSION_KEY = "last_run_version";
const SEMVER = /^\d+\.\d+\.\d+$/;

export const CURATED_NOTES_PATH = "release-notes/latest-release-notes.json";

export type ReleaseNoteKind = "breaking" | "feature" | "improvement" | "fix";
const KIND_ORDER: ReleaseNoteKind[] = ["breaking", "feature", "improvement", "fix"];

export type ReleaseNoteItem = {
  kind: ReleaseNoteKind;
  title: string;
  description: string | null;
  /** The conventional-commit scope, e.g. "i18n". */
  scope: string | null;
  images: { url: string; caption: string | null }[];
  /** A command to copy, e.g. how to connect an AI assistant. */
  code: string | null;
  /** Shown as a large card above the rest. */
  highlight: boolean;
  url: string | null;
};

export type ReleaseNotes = {
  version: string;
  /** "curated" from the hand-written file, "changelog" from CHANGELOG.md, "none" when neither could be read. */
  source: "curated" | "changelog" | "none";
  title: string | null;
  summary: string | null;
  items: ReleaseNoteItem[];
  releases_url: string;
};

/** Where a notification opens the What's new dialog; a bare query keeps whichever page is open. */
export function whatsNewPath(version: string, since: string | null): string {
  const params = new URLSearchParams({ "whats-new": version });
  if (since) params.set("since", since);
  return `?${params}`;
}

/** At startup: when this version is newer than the one that ran last, every user gets a notification that opens
 *  What's new. A fresh install has no users yet, so only an instance that ran before this check is told. */
export async function announceVersionUpdate(version = getBackendVersion(), now = new Date()): Promise<boolean> {
  if (!version || !SEMVER.test(version)) return false;
  const row = await prisma.setting.findUnique({ where: { key: LAST_RUN_VERSION_KEY } });
  const previous = typeof row?.value === "string" && SEMVER.test(row.value) ? row.value : null;
  if (previous === version) return false;
  const updated = previous ? compareVersions(version, previous) > 0 : (await prisma.user.count()) > 0;
  const users = updated ? await prisma.user.findMany({ select: { id: true } }) : [];
  await prisma.$transaction([
    prisma.setting.upsert({
      where: { key: LAST_RUN_VERSION_KEY },
      create: { key: LAST_RUN_VERSION_KEY, value: version },
      update: { value: version },
    }),
    prisma.notification.createMany({
      data: users.map((user) => ({
        userId: user.id,
        type: "system",
        title: `Thanks for updating to Thingport ${version}`,
        body: "This release brings a lot of new things. Click here to see what's new.",
        internalPath: whatsNewPath(version, previous),
        createdAt: now,
      })),
    }),
  ]);
  return updated;
}

const curatedSchema = z.object({
  version: z.string().trim().regex(SEMVER),
  title: z.string().trim().max(200).nullish(),
  summary: z.string().trim().max(2000).nullish(),
  items: z
    .array(
      z.object({
        type: z.enum(["breaking", "feature", "improvement", "fix"]),
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).nullish(),
        highlight: z.boolean().default(false),
        code: z.string().trim().max(1000).nullish(),
        // Relative to the JSON file, e.g. "screenshots/1.2.0-dashboard.png", or a full https URL.
        images: z
          .array(z.object({ src: z.string().trim().min(1).max(500), caption: z.string().trim().max(200).nullish() }))
          .max(6)
          .default([]),
        url: z
          .string()
          .url()
          .refine((value) => value.startsWith("https://"))
          .nullish(),
      }),
    )
    .min(1)
    .max(100),
});

/** Null when the file is malformed: the changelog is shown instead. */
export function parseCuratedNotes(data: unknown, fileUrl: string): Omit<ReleaseNotes, "releases_url"> | null {
  const parsed = curatedSchema.safeParse(data);
  if (!parsed.success) return null;
  const allowed = new Set(["https:", new URL(fileUrl).protocol]);
  const resolve = (src: string): string | null => {
    try {
      const url = new URL(src, fileUrl);
      return allowed.has(url.protocol) ? url.toString() : null;
    } catch {
      return null;
    }
  };
  const { version, title, summary, items } = parsed.data;
  return {
    version,
    source: "curated",
    title: title || null,
    summary: summary || null,
    items: sortItems(
      items.map((item) => ({
        kind: item.type,
        title: item.title,
        description: item.description || null,
        scope: null,
        images: item.images.flatMap((image) => {
          const url = resolve(image.src);
          return url ? [{ url, caption: image.caption || null }] : [];
        }),
        code: item.code || null,
        highlight: item.highlight,
        url: item.url ?? null,
      })),
    ),
  };
}

export type ChangelogRelease = {
  version: string;
  /** YYYY-MM-DD */
  date: string | null;
  items: (ReleaseNoteItem & { sha: string | null })[];
};

// "# [thingport-backend-v1.1.0](...compare...) (2026-10-20)" or "# thingport-backend-v1.0.0 (2026-10-17)";
// semantic-release gives patch releases "##".
const RELEASE_HEADING = /^#{1,2} \[?[\w.-]*?v?(\d+\.\d+\.\d+)\]?(?:\([^)]*\))?(?: \((\d{4}-\d{2}-\d{2})\))?\s*$/;
const SECTION_HEADING = /^#{3,4} (.+?)\s*$/;
const SECTION_KINDS: Record<string, ReleaseNoteKind> = {
  Features: "feature",
  "Bug Fixes": "fix",
  "Performance Improvements": "improvement",
  "BREAKING CHANGES": "breaking",
};
// "* **i18n:** count plural forms ([993c75c](https://.../commit/993c...)), closes [#91](...)"
const ITEM = /^[*-] (?:\*\*([^*]+?):\*\* )?(.+?)(?: \(\[([0-9a-f]{7,40})\]\((https:\/\/[^)\s]+)\)\))?(?:, closes .*)?$/;

/** Commit subjects can carry markdown, e.g. "([#16](https://...))"; the dialog shows plain text. */
function plainTitle(text: string): string {
  const plain = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]/g, "")
    .trim();
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

/** The releases in a semantic-release CHANGELOG.md, newest first as written. */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | null = null;
  let kind: ReleaseNoteKind | null = null;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const heading = line.match(RELEASE_HEADING);
    if (heading) {
      release = { version: heading[1], date: heading[2] ?? null, items: [] };
      releases.push(release);
      kind = null;
      continue;
    }
    const section = line.match(SECTION_HEADING);
    if (section) {
      kind = SECTION_KINDS[section[1]] ?? null;
      continue;
    }
    if (!release || !kind) continue;
    const item = line.match(ITEM);
    if (!item) continue;
    release.items.push({
      kind,
      title: plainTitle(item[2]),
      description: null,
      scope: item[1]?.trim() || null,
      images: [],
      code: null,
      highlight: false,
      url: item[4] ?? null,
      sha: item[3] ?? null,
    });
  }
  return releases;
}

function sortItems<T extends ReleaseNoteItem>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .toSorted((a, b) => KIND_ORDER.indexOf(a.item.kind) - KIND_ORDER.indexOf(b.item.kind) || a.index - b.index)
    .map(({ item }) => item);
}

/** The backend's releases after `since` up to `version` (just `version` without it), plus the frontend's releases
 *  out by then since the oldest of those: the two are versioned apart but released together. One change touching
 *  both shows once. */
export function notesFromChangelogs(
  backend: ChangelogRelease[],
  frontend: ChangelogRelease[],
  options: {
    version: string;
    since?: string | null;
    frontendVersion?: string | null;
    /** Only the releases before `version`, for curated notes that already cover it. */
    earlierOnly?: boolean;
  },
): ReleaseNoteItem[] {
  const { version, since, frontendVersion, earlierOnly = false } = options;
  if (earlierOnly && !since) return [];
  const inRange = (release: ChangelogRelease) =>
    compareVersions(release.version, version) < (earlierOnly ? 0 : 1) &&
    (since ? compareVersions(release.version, since) > 0 : release.version === version);
  const limit = earlierOnly ? MAX_VERSIONS - 1 : MAX_VERSIONS;
  const backendReleases = backend
    .filter(inRange)
    .toSorted((a, b) => compareVersions(b.version, a.version))
    .slice(0, limit);
  // The frontend that went out with `version` is the curated notes' too.
  const until = earlierOnly ? (backend.find((r) => r.version === version)?.date ?? null) : null;
  const dates = backendReleases.map((r) => r.date).filter((d): d is string => Boolean(d));
  const from = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
  const frontendReleases = from
    ? frontend
        .filter(
          (r) =>
            r.date &&
            r.date >= from &&
            (!until || r.date < until) &&
            (!frontendVersion || compareVersions(r.version, frontendVersion) <= 0),
        )
        .slice(0, limit)
    : [];

  const seen = new Set<string>();
  const items: ReleaseNoteItem[] = [];
  for (const release of [...backendReleases, ...frontendReleases]) {
    for (const { sha, ...item } of release.items) {
      const key = sha ?? `${item.kind}\n${item.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return sortItems(items);
}

const cache = new Map<string, { at: number; text: string | null }>();

/** A failed fetch keeps the last good copy; misses are cached too, so a dialog opened offline doesn't wait each time. */
async function fetchText(url: string, now = Date.now()): Promise<string | null> {
  const hit = cache.get(url);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.text;
  let text: string | null = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.ok) text = await res.text();
  } catch {
    // offline or blocked
  }
  cache.set(url, { at: now, text: text ?? hit?.text ?? null });
  return text ?? hit?.text ?? null;
}

export function clearReleaseNotesCache(): void {
  cache.clear();
}

export async function getReleaseNotes(
  options: { version?: string | null; since?: string | null; frontendVersion?: string | null } = {},
  baseUrl = RELEASE_NOTES_URL,
): Promise<ReleaseNotes | null> {
  const version = options.version ?? getBackendVersion();
  if (!version || !SEMVER.test(version)) return null;
  const releases_url = `https://github.com/${GITHUB_REPO}/releases`;
  const empty: ReleaseNotes = { version, source: "none", title: null, summary: null, items: [], releases_url };
  if (!baseUrl) return empty;

  const curatedUrl = `${baseUrl}/${CURATED_NOTES_PATH}`;
  const [curatedText, backendText, frontendText] = await Promise.all([
    fetchText(curatedUrl),
    fetchText(`${baseUrl}/backend/CHANGELOG.md`),
    fetchText(`${baseUrl}/frontend/CHANGELOG.md`),
  ]);

  const since = options.since && SEMVER.test(options.since) ? options.since : null;
  const frontendVersion =
    options.frontendVersion && SEMVER.test(options.frontendVersion) ? options.frontendVersion : null;
  const fromChangelogs = (earlierOnly: boolean) =>
    backendText
      ? notesFromChangelogs(parseChangelog(backendText), parseChangelog(frontendText ?? ""), {
          version,
          since,
          frontendVersion,
          earlierOnly,
        })
      : [];

  let curated: ReturnType<typeof parseCuratedNotes> = null;
  try {
    curated = curatedText ? parseCuratedNotes(JSON.parse(curatedText), curatedUrl) : null;
  } catch {
    // not JSON: the changelog is shown instead
  }
  if (curated?.version === version) {
    // Someone who skipped releases gets theirs from the changelog after the curated ones; commit links aren't
    // "Learn more" links.
    const earlier = fromChangelogs(true);
    for (const item of earlier) item.url = null;
    return { ...curated, items: [...curated.items, ...earlier], releases_url };
  }

  if (!backendText) return empty;
  return { ...empty, source: "changelog", items: fromChangelogs(false) };
}
