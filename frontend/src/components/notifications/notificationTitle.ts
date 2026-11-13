import type { TFunction } from "i18next";
import type { Notification } from "../../api/notifications";
import { achievementDef, achievementName, tierLabel } from "../../constants/achievements";

/** The title in the reader's language from the message the server sent with it, or its English title for a kind not
 *  translated yet and for one written before. Names come through as they were. */
export function notificationTitle(notification: Notification, t: TFunction): string {
  const { message } = notification;
  if (!message) return notification.title;
  return t(`notifications.messages.${message.key}`, {
    ...message.values,
    ...achievementValues(message, t),
    defaultValue: notification.title,
  });
}

/** An achievement's name and tier, from its id: names are this app's to translate, not the server's to send. */
function achievementValues(message: NonNullable<Notification["message"]>, t: TFunction): Record<string, string> {
  if (message.key !== "achievementUnlocked") return {};
  const def = achievementDef(String(message.values?.badge ?? ""));
  const tier = Number(message.values?.tier ?? 0);
  return def ? { name: achievementName(def, t), tier: tierLabel(def, tier, t) } : {};
}
