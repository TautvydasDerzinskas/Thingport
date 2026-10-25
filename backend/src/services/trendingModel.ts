// What every provider's trending list comes down to, for the dashboard's trending panel. Each provider's client reads
// its own list into this shape, so the panel needn't know any of them.

export type TrendingModel = {
  id: string;
  title: string;
  /** The model's page on the provider's site. */
  url: string;
  image: string | null;
  likes: number | null;
  author: string | null;
  /** Sold rather than free, where the provider says. */
  paid: boolean;
};

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null;

export const asCount = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** The records in a list, skipping anything that isn't one. */
export const recordsOf = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        return record ? [record] : [];
      })
    : [];

/** Only http(s) images, so a page never loads something odd from a provider's data. */
export const webImage = (value: unknown): string | null => {
  const url = asText(value);
  return url && /^https?:\/\//i.test(url) ? url : null;
};
