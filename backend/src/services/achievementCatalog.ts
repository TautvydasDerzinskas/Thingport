import { PROVIDER_IDS } from "../providers/index.generated";

// Every badge there is, by id. Ids are stored per user (UserAchievement.badge) and sent to partner instances, which
// draw them from their own copy of this list (frontend/src/constants/achievements.ts), so an id is never renamed or
// reused: a badge that goes is left out, and a new one gets a new id.

/** 1, 10, 100, 200, 500, 1000: bronze, silver, gold, platinum, diamond, holographic. */
const LADDER = [1, 10, 100, 200, 500, 1000];

/** What a badge counts. */
export type BadgeCounter =
  | { kind: "downloads" }
  | { kind: "imports" }
  | { kind: "site"; provider: string }
  | { kind: "tool"; slug: string }
  | { kind: "studio" }
  | { kind: "synced" }
  | { kind: "syncSources" }
  | { kind: "regular" }
  | { kind: "secret" };

export type BadgeDef = {
  id: string;
  /** What a count must reach for each tier, lowest first. */
  thresholds: number[];
  counter: BadgeCounter;
  /** Where it sorts beside the others, for a single-tier badge: the tier of a ladder it stands level with. */
  rank?: number;
};

/** The repository's tools that make models, each with a badge for what's saved from it (Print.createdWith "tool"). */
export const BADGE_TOOLS = [
  "keyring-generator",
  "qr-code-generator",
  "gridfinity-drawer",
  "enclosure-generator",
  "multiboard-planner",
  "skadis-planner",
  "openscad-customizer",
  "makerworld-3mf-normalizer",
] as const;

/** Secrets a widget or tool gives away, as `<its slug>/<key>`: what its `thingport.achievements.unlock(key)` asks for. */
export const SECRETS = ["weather-scene/guest"] as const;

/** "Regular": on more than 20 of the last 30 days (UTC), gone grey once that's no longer so. */
export const REGULAR_WINDOW_DAYS = 30;
export const REGULAR_MIN_DAYS = 21;

export const BADGES: readonly BadgeDef[] = [
  { id: "downloads", thresholds: LADDER, counter: { kind: "downloads" } },
  { id: "imports", thresholds: LADDER, counter: { kind: "imports" } },
  { id: "regular", thresholds: [REGULAR_MIN_DAYS], counter: { kind: "regular" }, rank: 2 },
  ...PROVIDER_IDS.map((provider): BadgeDef => ({
    id: `site:${provider}`,
    thresholds: [1, 10, 100],
    counter: { kind: "site", provider },
  })),
  ...BADGE_TOOLS.map((slug): BadgeDef => ({
    id: `tool:${slug}`,
    thresholds: [1, 10, 50],
    counter: { kind: "tool", slug },
  })),
  { id: "studio", thresholds: [1, 10, 50, 100], counter: { kind: "studio" } },
  { id: "synced", thresholds: [1, 5, 10, 25], counter: { kind: "synced" } },
  { id: "sync-sources", thresholds: [3], counter: { kind: "syncSources" }, rank: 3 },
  ...SECRETS.map((secret): BadgeDef => ({
    id: `secret:${secret}`,
    thresholds: [1],
    counter: { kind: "secret" },
    rank: -1,
  })),
];

const BY_ID = new Map(BADGES.map((badge) => [badge.id, badge]));

export function badgeDef(id: string): BadgeDef | undefined {
  return BY_ID.get(id);
}

/** Where a badge at `tier` sorts: higher first, a secret last. */
export function badgeRank(def: BadgeDef, tier: number): number {
  return def.rank ?? tier;
}
