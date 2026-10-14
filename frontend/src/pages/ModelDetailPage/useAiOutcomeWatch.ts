import { useCallback, useEffect, useRef } from "react";
import { notificationsApi } from "../../api/notifications";
import { type Print, printsApi } from "../../api/prints";
import { useNotifications } from "../../components/Layout/NotificationsContext";

const POLL_INTERVAL_MS = 3000;
// Past the longest a provider can take: three attempts at the 300 s timeout settings allow.
const GIVE_UP_MS = 16 * 60_000;
const RECENT = 10;

/**
 * Runs `queue` (a background AI request for one model), then waits for its notification and hands back the reloaded
 * model, so the page that asked shows the outcome. The bell's own poll is slow and only counts. Notifications from
 * before the request are noted first, so no clock comparison decides which one is new.
 */
export function useAiOutcomeWatch(printId: string, onUpdated?: (print: Print) => void) {
  const { refresh } = useNotifications();
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  return useCallback(
    async (queue: () => Promise<void>) => {
      stopRef.current?.();
      const before = new Set(
        (await notificationsApi.list({ limit: RECENT }).catch(() => ({ items: [] }))).items.map((item) => item.id),
      );
      await queue();

      let stopped = false;
      let timer: number | undefined;
      const stop = () => {
        stopped = true;
        window.clearTimeout(timer);
      };
      stopRef.current = stop;
      const path = `/models/${printId}`;
      const giveUpAt = Date.now() + GIVE_UP_MS;
      const check = async () => {
        try {
          const { items } = await notificationsApi.list({ limit: RECENT });
          if (stopped) return;
          if (items.some((item) => item.type === "ai" && item.internal_path === path && !before.has(item.id))) {
            stop();
            void refresh();
            onUpdated?.(await printsApi.get(printId));
            return;
          }
        } catch {
          // A failed check just waits for the next one.
        }
        if (!stopped && Date.now() < giveUpAt) timer = window.setTimeout(() => void check(), POLL_INTERVAL_MS);
      };
      timer = window.setTimeout(() => void check(), POLL_INTERVAL_MS);
    },
    [printId, onUpdated, refresh],
  );
}
