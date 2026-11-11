import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { UnauthorizedError } from "../../api/client";
import { printsApi } from "../../api/prints";
import { useToast } from "../../components/ToastProvider";
import type { SlicerTarget } from "./useOpenInSlicer";

export type AdaptState = "idle" | "preparing" | "ready";

const POLL_MS = 2000;

/** "Open adapted in <slicer>": asks the server for the copy that slicer gets and polls until it's made, so no
 *  request has to outlast a proxy timeout. A cached copy opens straight away. A slow one ends in "ready" and needs a
 *  second click: browsers only launch a slicer's protocol right after a click. */
export function useAdaptedOpen(
  printId: string,
  slicerId: string | null,
  onOpened: () => void,
  onUnauthorized?: () => void,
) {
  const { t } = useTranslation(["models"]);
  const showToast = useToast();
  const [states, setStates] = useState<Record<string, AdaptState>>({});
  // Set on every mount: StrictMode unmounts and remounts once in development.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A copy is made for one slicer: switching slicers starts again.
  const keyOf = useCallback((target: SlicerTarget) => `${slicerId ?? ""}:${target.key}`, [slicerId]);

  const setState = useCallback((key: string, state: AdaptState) => {
    if (mounted.current) setStates((prev) => ({ ...prev, [key]: state }));
  }, []);

  const stateOf = useCallback((target: SlicerTarget): AdaptState => states[keyOf(target)] ?? "idle", [states, keyOf]);

  /** Resolves true when the slicer was launched, so a menu can close. */
  const open = useCallback(
    async (target: SlicerTarget): Promise<boolean> => {
      const key = keyOf(target);
      const launch = () => {
        window.location.href = target.href;
        setState(key, "idle");
        onOpened();
        return true;
      };
      const current = states[key] ?? "idle";
      if (current === "ready") return launch();
      if (current === "preparing" || !target.plate || !slicerId) return false;

      setState(key, "preparing");
      try {
        let { status } = await printsApi.adaptPlate(printId, target.plate.id, slicerId);
        // The adapted link serves the plate itself when no copy is needed, so either opens it.
        if (status === "ready" || status === "original") return launch();
        while (status === "preparing") {
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          if (!mounted.current) return false;
          ({ status } = await printsApi.adaptPlate(printId, target.plate.id, slicerId));
        }
        if (status === "failed") throw new Error("Adapting failed");
        setState(key, "ready");
        return false;
      } catch (err) {
        setState(key, "idle");
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else if (mounted.current) showToast({ message: t("models:detail.adaptFailed"), severity: "warning" });
        return false;
      }
    },
    [states, keyOf, printId, slicerId, onOpened, onUnauthorized, setState, showToast, t],
  );

  return { stateOf, open };
}
