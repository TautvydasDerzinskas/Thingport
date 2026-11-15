import { fetchQidimakerCollection, QidimakerAuthError } from "./api";
import { getUserQidimakerToken, markQidimakerSessionRejected } from "./session";

export type QidimakerCollection = NonNullable<Awaited<ReturnType<typeof fetchQidimakerCollection>>>;

/**
 * A collection as the user can read it: with their sign-in where Thingport has one, so their own private collections
 * read too, else without it, as anyone's public ones do. A sign-in the site turns down is remembered and the
 * collection read without it.
 *
 * Null where the site has no such collection for them: deleted, or private to someone else. "signIn" where, read
 * without a sign-in, it may be either of those or one of the user's own private ones: the site answers all three
 * alike, so only their sign-in can tell, and it mustn't be taken for gone.
 */
export async function readQidimakerCollection(
  userId: string,
  collectionId: string,
  maxItems?: number,
): Promise<QidimakerCollection | null | "signIn"> {
  const token = await getUserQidimakerToken(userId);
  if (token) {
    try {
      return await fetchQidimakerCollection(collectionId, token, maxItems);
    } catch (err) {
      if (!(err instanceof QidimakerAuthError)) throw err;
      await markQidimakerSessionRejected(userId, token);
    }
  }
  return (await fetchQidimakerCollection(collectionId, null, maxItems)) ?? "signIn";
}
