import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { notificationsApi } from "../../api/notifications";
import { UnauthorizedError } from "../../api/client";
import { useUnreadBadge } from "../notifications/useUnreadBadge";

type NotificationsContextValue = {
  unreadCount: number;
  refresh: () => Promise<void>;
  /** Resolves to the time stamped on them (null if it failed): what counts as new while the list is open. */
  markAllRead: () => Promise<string | null>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

// Only catches notifications from other tabs/devices; a finished import refreshes directly.
const POLL_INTERVAL_MS = 45_000;

/** The unread count for the bell's badge. The lists themselves load per tab (useNotificationFeed). */
export function NotificationsProvider({
  onUnauthorized,
  children,
}: {
  onUnauthorized?: () => void;
  children: React.ReactNode;
}) {
  const [unreadCount, setUnreadCount] = useState(0);
  useUnreadBadge(unreadCount);

  const refresh = useCallback(async () => {
    try {
      const result = await notificationsApi.list({ limit: 1 });
      setUnreadCount(result.unread_count);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
    }
  }, [onUnauthorized]);

  // Overlapping calls share one request: a second one would find nothing left to mark and answer a
  // later time, hiding what the first one marked (React runs effects twice in development).
  const pendingMarkAll = useRef<Promise<string | null> | null>(null);
  const markAllRead = useCallback(() => {
    pendingMarkAll.current ??= notificationsApi
      .markAllRead()
      .then((readAt) => {
        setUnreadCount(0);
        return readAt;
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        return null;
      })
      .finally(() => {
        pendingMarkAll.current = null;
      });
    return pendingMarkAll.current;
  }, [onUnauthorized]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => ({ unreadCount, refresh, markAllRead }), [unreadCount, refresh, markAllRead]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within a NotificationsProvider");
  return ctx;
}
