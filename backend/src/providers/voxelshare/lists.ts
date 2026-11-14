import { fetchVoxelshareCollection, VoxelshareAuthError } from "./api";
import { getUserVoxelshareToken, markVoxelshareSessionRejected } from "./session";

export type VoxelshareCollection = Exclude<Awaited<ReturnType<typeof fetchVoxelshareCollection>>, null | "private">;

/**
 * A collection as the user can read it: with their sign-in where Thingport has one, so their own private collections
 * read in full, else without it, as anyone's public ones do. A sign-in the site turns down is remembered and the
 * collection read without it.
 *
 * Null where the site has no such collection. "signIn" where it's private and there's no sign-in to read it with: the
 * site shows a stranger its details, but whether it shows them all its models is unknown, so it's neither read nor
 * taken for gone.
 */
export async function readVoxelshareCollection(
  userId: string,
  collectionId: string,
  maxItems?: number,
): Promise<VoxelshareCollection | null | "signIn"> {
  const token = await getUserVoxelshareToken(userId);
  if (token) {
    try {
      return (await fetchVoxelshareCollection(collectionId, token, maxItems)) as VoxelshareCollection | null;
    } catch (err) {
      if (!(err instanceof VoxelshareAuthError)) throw err;
      await markVoxelshareSessionRejected(userId, token);
    }
  }
  const collection = await fetchVoxelshareCollection(collectionId, null, maxItems);
  return collection === "private" ? "signIn" : collection;
}
