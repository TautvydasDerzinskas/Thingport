import type { TFunction } from "i18next";
import type { Notification } from "../../api/notifications";

/** The title in the reader's language from the message the server sent with it, or its English title for a kind not
 *  translated yet and for one written before. Names come through as they were. */
export function notificationTitle(notification: Notification, t: TFunction): string {
  const { message } = notification;
  if (!message) return notification.title;
  return t(`notifications.messages.${message.key}`, { ...message.values, defaultValue: notification.title });
}
