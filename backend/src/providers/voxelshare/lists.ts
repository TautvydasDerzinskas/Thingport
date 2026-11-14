import { fetchVoxelshareCollection, voxelshareSiteIdOf, VoxelshareAuthError } from "./api";
import { getUserVoxelshareToken, markVoxelshareSessionRejected } from "./session";

export type VoxelshareCollection = Exclude<Awaited<ReturnType<typeof fetchVoxelshareCollection>>, null | "private">;

/**
 * A collection as the user can read it, by the id it's kept under, from the site that names: with their sign-in there
 * where Thingport has one, so their own private collections read in full, else without it, as anyone's public ones
 * do. A sign-in the site turns down is remembered and the collection read without it.
 *
 * Null where the site has no such collection. "signIn" where it's private and there's no sign-in to read it with: the
 * site shows a stranger its details, but whether it shows them all its models is unknown, so it's neither read nor
 * taken for gone.
 */
export async function readVoxelshareCollection(
  userId: string,
  externalId: string,
  maxItems?: number,
): Promise<VoxelshareCollection | null | "signIn"> {
  const { region, id } = voxelshareSiteIdOf(externalId);
  const token = await getUserVoxelshareToken(userId, region);
  if (token) {
    try {
      return (await fetchVoxelshareCollection(id, token, maxItems, region)) as VoxelshareCollection | null;
    } catch (err) {
      if (!(err instanceof VoxelshareAuthError)) throw err;
      await markVoxelshareSessionRejected(userId, token, region);
    }
  }
  const collection = await fetchVoxelshareCollection(id, null, maxItems, region);
  return collection === "private" ? "signIn" : collection;
}
