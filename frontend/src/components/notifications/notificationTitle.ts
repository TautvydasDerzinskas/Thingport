import type { TFunction } from "i18next";
import type { Notification } from "../../api/notifications";

/** Older notifications store English text; translate only known import messages, preserving model names. */
export function notificationTitle(notification: Notification, t: TFunction): string {
  if (notification.type !== "import") return notification.title;
  const single = /^Imported "([\s\S]*)"$/.exec(notification.title);
  if (single) return t("notifications.importedNamed", { name: single[1] });
  const multiple = /^Imported (\d+) models$/.exec(notification.title);
  if (multiple) return t("activity.timeline.import", { count: Number(multiple[1]) });
  return notification.title;
}
