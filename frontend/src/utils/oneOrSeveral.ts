/**
 * The count to give a text that says one thing or several without showing how many ("{{names}} is deleted" / "are
 * deleted"). In Russian, Lithuanian and others the "one" form also covers 21, 31…, so the real count would call 21 tags
 * "it"; 2 picks a plural form in every language.
 */
export function oneOrSeveral(count: number): number {
  return count === 1 ? 1 : 2;
}
