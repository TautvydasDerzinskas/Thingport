/** A title the app translates: `notifications.messages.<key>` with these values. */
export type NotificationMessage = { key: string; values?: Record<string, string | number> };

/** The stored message, checked rather than trusted: anything else shows the English title. */
export function readNotificationMessage(value: unknown): NotificationMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { key, values } = value as Record<string, unknown>;
  if (typeof key !== "string" || !key) return null;
  if (values === undefined) return { key };
  if (!values || typeof values !== "object" || Array.isArray(values)) return null;
  const entries = Object.entries(values).filter(
    (entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number",
  );
  return { key, values: Object.fromEntries(entries) };
}
