import type { TFunction } from "i18next";
import type { Achievement } from "../api/achievements";
import { MANIFESTS, PROVIDER_IDS, type ProviderId } from "../providers/index.generated";

// What each achievement looks like and is called, by its id: the backend's catalogue (services/achievementCatalog.ts)
// says what earns one, this says how it's drawn. A partner instance may send ids this one doesn't know yet (it's
// newer); those are left out (`knownAchievements`).

/** What a badge is struck in: a ladder's tier, or a single-tier badge's own. */
export type Material = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "holo" | "secret";
export const LADDER_MATERIALS: Material[] = ["bronze", "silver", "gold", "platinum", "diamond", "holo"];

export type Glyph =
  | "download"
  | "import"
  | "regular"
  | "studio"
  | "sync"
  | "sources"
  | "keyring"
  | "qr"
  | "gridfinity"
  | "enclosure"
  | "multiboard"
  | "skadis"
  | "openscad"
  | "normalize"
  | "guest"
  | `provider:${ProviderId}`;

/** The sticker's shape, which says what kind of badge it is. */
export type Cut = "shield" | "squircle" | "cog" | "hex" | "rosette" | "mascot";

export type AchievementGroup = "milestones" | "sites" | "tools" | "making" | "secrets";
export const ACHIEVEMENT_GROUPS: AchievementGroup[] = ["milestones", "sites", "tools", "making", "secrets"];

type Words = { kind: "badge"; key: string } | { kind: "site"; provider: ProviderId } | { kind: "tool"; slug: string };

export type AchievementDef = {
  id: string;
  group: AchievementGroup;
  glyph: Glyph;
  cut: Cut;
  /** What each tier needs, as the backend has them: shown in its rule and as its number. */
  thresholds: number[];
  /** A single-tier badge's material; a ladder's comes from its tier. */
  material?: Material;
  words: Words;
};

const LADDER = [1, 10, 100, 200, 500, 1000];

/** The repository's tools that make models, with the glyph each one's badge carries. */
const TOOL_GLYPHS: Record<string, Glyph> = {
  "keyring-generator": "keyring",
  "qr-code-generator": "qr",
  "gridfinity-drawer": "gridfinity",
  "enclosure-generator": "enclosure",
  "multiboard-planner": "multiboard",
  "skadis-planner": "skadis",
  "openscad-customizer": "openscad",
  "makerworld-3mf-normalizer": "normalize",
};

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "downloads",
    group: "milestones",
    glyph: "download",
    cut: "shield",
    thresholds: LADDER,
    words: { kind: "badge", key: "downloads" },
  },
  {
    id: "imports",
    group: "milestones",
    glyph: "import",
    cut: "shield",
    thresholds: LADDER,
    words: { kind: "badge", key: "imports" },
  },
  {
    id: "regular",
    group: "milestones",
    glyph: "regular",
    cut: "rosette",
    thresholds: [21],
    material: "gold",
    words: { kind: "badge", key: "regular" },
  },
  ...PROVIDER_IDS.map((provider): AchievementDef => ({
    id: `site:${provider}`,
    group: "sites",
    glyph: `provider:${provider}`,
    cut: "squircle",
    thresholds: [1, 10, 100],
    words: { kind: "site", provider },
  })),
  ...Object.entries(TOOL_GLYPHS).map(([slug, glyph]): AchievementDef => ({
    id: `tool:${slug}`,
    group: "tools",
    glyph,
    cut: "cog",
    thresholds: [1, 10, 50],
    words: { kind: "tool", slug },
  })),
  {
    id: "studio",
    group: "making",
    glyph: "studio",
    cut: "hex",
    thresholds: [1, 10, 50, 100],
    words: { kind: "badge", key: "studio" },
  },
  {
    id: "synced",
    group: "making",
    glyph: "sync",
    cut: "rosette",
    thresholds: [1, 5, 10, 25],
    words: { kind: "badge", key: "synced" },
  },
  {
    id: "sync-sources",
    group: "making",
    glyph: "sources",
    cut: "rosette",
    thresholds: [3],
    material: "platinum",
    words: { kind: "badge", key: "syncSources" },
  },
  {
    id: "secret:weather-scene/guest",
    group: "secrets",
    glyph: "guest",
    cut: "mascot",
    thresholds: [1],
    material: "secret",
    words: { kind: "badge", key: "weatherGuest" },
  },
];

const BY_ID = new Map(ACHIEVEMENTS.map((def) => [def.id, def]));

export function achievementDef(id: string): AchievementDef | undefined {
  return BY_ID.get(id);
}

/** A badge with what draws it, its tier kept within what this instance's catalogue has. */
export type ShownAchievement<T extends Achievement = Achievement> = T & { def: AchievementDef };

/** The ones this instance can draw, in the order given (the backend's: best first, secrets last). */
export function knownAchievements<T extends Achievement>(items: T[] | null | undefined): ShownAchievement<T>[] {
  return (items ?? []).flatMap((item) => {
    const def = BY_ID.get(item.id);
    return def ? [{ ...item, tier: Math.min(Math.max(0, item.tier), def.thresholds.length - 1), def }] : [];
  });
}

export function materialOf(def: AchievementDef, tier: number): Material {
  return def.material ?? LADDER_MATERIALS[Math.min(tier, LADDER_MATERIALS.length - 1)];
}

/** The number on its tag: the tier's threshold, short ("1K"). None for a single-tier badge. */
export function plateOf(def: AchievementDef, tier: number): string | undefined {
  if (def.material) return undefined;
  const value = def.thresholds[tier];
  return value >= 1000 ? `${value / 1000}K` : String(value);
}

function providerName(provider: ProviderId): string {
  return MANIFESTS[provider].name;
}

const KEY = "app:achievements";

export function achievementName(def: AchievementDef, t: TFunction): string {
  const { words } = def;
  if (words.kind === "site") return t(`${KEY}.badges.site.name`, { site: providerName(words.provider) });
  if (words.kind === "tool") return t(`${KEY}.tools.${words.slug}.badge`);
  return t(`${KEY}.badges.${words.key}.name`);
}

/** What earns it at `tier`: "Download models 100 times". */
export function achievementRule(def: AchievementDef, tier: number, t: TFunction): string {
  const count = def.thresholds[tier] ?? def.thresholds[0];
  const { words } = def;
  if (words.kind === "site") return t(`${KEY}.badges.site.rule`, { count, site: providerName(words.provider) });
  if (words.kind === "tool") return t(`${KEY}.badges.tool.rule`, { count, tool: t(`${KEY}.tools.${words.slug}.tool`) });
  return t(`${KEY}.badges.${words.key}.rule`, { count });
}

/** Where it stands now, for its owner: "164 downloads". Null for a secret, which counts nothing. */
export function achievementStat(def: AchievementDef, count: number | null, t: TFunction): string | null {
  const { words } = def;
  if (count === null)
    return words.kind === "badge" && def.group === "secrets" ? t(`${KEY}.badges.${words.key}.stat`) : null;
  if (words.kind === "site") return t(`${KEY}.badges.site.stat`, { count, site: providerName(words.provider) });
  if (words.kind === "tool") return t(`${KEY}.badges.tool.stat`, { count, tool: t(`${KEY}.tools.${words.slug}.tool`) });
  return t(`${KEY}.badges.${words.key}.stat`, { count });
}

/** "Gold · 100", "Gold", "Secret". */
export function tierLabel(def: AchievementDef, tier: number, t: TFunction): string {
  const material = t(`${KEY}.tiers.${materialOf(def, tier)}`);
  const plate = plateOf(def, tier);
  return plate ? `${material} · ${plate}` : material;
}
