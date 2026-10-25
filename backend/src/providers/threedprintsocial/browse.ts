import { readConnection, writeConnection } from "../connections";
import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import {
  fetchPrintSocialCollectionCards,
  PrintSocialBlockedError,
  printSocialListCard,
  printSocialListOf,
  PrintSocialRateLimitError,
  printSocialSlugFrom,
  resolvePrintSocialCreator,
} from "./api";
import manifest from "./manifest.generated";

export const printSocialBrowse: ProviderBrowse = {
  // Nothing to connect: who the user is there is the creator they publish as, which they give.
  async account(userId) {
    return { connected: true, account: (await readConnection(userId, manifest.id))?.accountName ?? null };
  },
  async setAccount(userId, value) {
    const slug = value ? printSocialSlugFrom(value) : null;
    if (value && !slug) throw new HttpError(400, `"${value}" isn't a 3DPrint.social creator's handle or page`);
    const creator = slug ? await resolvePrintSocialCreator(slug) : null;
    if (value && !creator) throw new HttpError(404, `3DPrint.social has no creator "${value}"`);
    await writeConnection(userId, manifest.id, {
      accountId: creator?.slug ?? null,
      accountName: creator?.slug ?? null,
    });
  },
  // Their models, as a list of its own, then their collections.
  async cards(userId) {
    const slug = (await readConnection(userId, manifest.id))?.accountId;
    if (!slug) throw new HttpError(409, "Tell Thingport your 3DPrint.social creator handle first");
    const [models, collections] = await Promise.all([
      printSocialListCard({ kind: "creator", slug }),
      fetchPrintSocialCollectionCards(slug),
    ]);
    return [...(models ? [models] : []), ...collections];
  },
  // Anyone's collection or creator, by their link.
  card: (_userId, source) => printSocialListCard(printSocialListOf(source.externalId)),
  httpError(err) {
    if (err instanceof PrintSocialRateLimitError) return new HttpError(429, err.message);
    if (err instanceof PrintSocialBlockedError) return new HttpError(503, err.message);
  },
};
