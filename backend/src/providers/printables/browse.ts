import { readConnection, writeConnection } from "../connections";
import manifest from "./manifest.generated";
import { HttpError } from "../../utils/fileUtils";
import { deletePrintablesListings, pushedLikes, pushedPrintablesCards } from "./listings";
import type { ProviderBrowse } from "../types";
import { fetchPrintablesCollectionCard, listPrintablesUserCollections, resolvePrintablesUser } from "./api";

export const printablesBrowse: ProviderBrowse = {
  async account(userId) {
    return { connected: true, account: (await readConnection(userId, manifest.id))?.accountName ?? null };
  },
  async setAccount(userId, value) {
    const user = value ? await resolvePrintablesUser(value) : null;
    if (value && !user) throw new HttpError(404, `Printables has no user "${value}"`);
    // Forgetting the account also turns off what Grab sends from Printables (the account turned down), and drops what
    // it sent: otherwise its next push would quietly link the account again.
    await writeConnection(userId, manifest.id, {
      accountId: user?.id ?? null,
      accountName: user?.handle ?? null,
      rejectedAt: user ? null : new Date(),
    });
    if (!user) await deletePrintablesListings(userId);
  },
  async cards(userId) {
    // Printables shows anyone the public ones; Thingport Grab adds the private ones and the likes.
    const printablesUserId = (await readConnection(userId, manifest.id))?.accountId;
    const pushed = await pushedPrintablesCards(userId);
    if (!printablesUserId && !pushed.collections) {
      throw new HttpError(409, "Tell Thingport your Printables username first");
    }
    const listed = printablesUserId ? await listPrintablesUserCollections(printablesUserId) : [];
    const listedIds = new Set(listed.map((card) => card.id));
    const privateOnes = (pushed.collections ?? []).filter((card) => card.private && !listedIds.has(card.id));
    return [...(pushed.likes ? [pushed.likes] : []), ...listed, ...privateOnes];
  },
  async card(userId, source) {
    if (source.likesOf) {
      // Printables shows likes to their owner only, so only the user's own, as Grab read them.
      const likes = await pushedLikes(userId);
      if (likes?.card.id !== source.externalId) {
        throw new HttpError(
          404,
          "Printables shows likes to their owner only. Open Printables signed in, with Thingport Grab installed, and your own appear here.",
        );
      }
      return likes.card;
    }
    return (
      (await fetchPrintablesCollectionCard(source.externalId)) ??
      (await pushedPrintablesCards(userId)).collections?.find((pushed) => pushed.id === source.externalId) ??
      null
    );
  },
};
