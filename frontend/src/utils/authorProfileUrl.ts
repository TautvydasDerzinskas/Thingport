import type { Author } from "../api/prints";
import { isProviderId, URLS } from "../providers/_generated";

/** A creator's page: the one their provider builds from their id where it does, else the first of their links. */
export function authorProfileUrl(author: Pick<Author, "provider" | "external_id" | "links">): string | null {
  const fromId = isProviderId(author.provider) ? URLS[author.provider].authorUrl?.(author.external_id) : undefined;
  return fromId ?? author.links[0] ?? null;
}
