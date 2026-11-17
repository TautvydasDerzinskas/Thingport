/**
 * Saves a setting row's picks one request at a time, until the last pick made while they went is the one saved:
 * `latest` is read after each answer, and another save goes out while it differs from what was asked. Gives up once
 * `gone` says the row has gone, so a pick left waiting there can't overwrite one saved after the page was opened
 * again. The last answer is returned.
 */
export async function saveLastPick<T>(
  latest: () => T,
  save: (value: T) => Promise<T>,
  gone: () => boolean,
): Promise<T> {
  for (;;) {
    const asked = latest();
    const saved = await save(asked);
    if (gone() || asked === latest()) return saved;
  }
}
