import type { TFunction } from "i18next";
import type { Chat } from "../../api/chats";

/** A room's name, or the other person's. */
export function chatTitle(chat: Pick<Chat, "kind" | "name" | "other">, t: TFunction): string {
  if (chat.kind === "room") return chat.name ?? "";
  return chat.other?.display_name ?? t("app:chats.deletedUser");
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** As a list shows when something was said: the time today, the weekday this week, the date before that. */
export function shortTime(iso: string, locale: string, now = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  if (days < 7) return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

export const clockTime = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Today, Yesterday, or the date: what a conversation's day separators say. */
export function dayLabel(iso: string, locale: string, t: TFunction, now = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) return t("app:chats.today");
  if (days === 1) return t("app:chats.yesterday");
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

export const sameDay = (a: string, b: string) => startOfDay(new Date(a)) === startOfDay(new Date(b));
