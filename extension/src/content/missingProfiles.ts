import type { ImportStatus } from "../shared/api";

/** Whether a model the library holds still lacks some of the page's print profiles, as after a partial import. The
 *  status of a bare model link says "imported" as soon as any profile is on the model, so each profile is asked
 *  about by its own link. A profile the instance can't tell about counts as held: it won't add one twice. */
export async function hasMissingProfiles(
  profileIds: string[],
  statusOf: (profileId: string) => Promise<ImportStatus>,
): Promise<boolean> {
  if (profileIds.length < 2) return false;
  const held = await Promise.all(
    profileIds.map((id) =>
      statusOf(id).then(
        (status) => status.already_imported,
        () => true,
      ),
    ),
  );
  return held.includes(false);
}
