import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { UnauthorizedError } from "../../api/client";
import { printsApi } from "../../api/prints";
import type { SlicerTarget } from "./useOpenInSlicer";

export type NormalizeState = "idle" | "preparing" | "ready";

const POLL_MS = 2000;

/** Readiness is per file AND per kind of copy: a "flat" copy being ready or preparing says nothing about the "orca" one. */
export function normalizeStateKey(target: SlicerTarget): string {
  return `${target.key}|${target.normalizeTarget ?? "flat"}|${target.plate?.id ?? ""}`;
}

/** "Open normalized in <slicer>": asks the server for a normalized copy and polls until it's built, so no
 *  request has to outlast a proxy timeout. A cached copy opens straight away. A slow one ends in
 *  "ready" and needs a second click: browsers only launch a slicer's protocol right after a click. */
export function useNormalizedOpen(printId: string, onOpened: () => void, onUnauthorized?: () => void) {
  const { t } = useTranslation(["models"]);
  const [states, setStates] = useState<Record<string, NormalizeState>>({});
  // Set on every mount: StrictMode unmounts and remounts once in development.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setState = useCallback((key: string, state: NormalizeState) => {
    if (mounted.current) setStates((prev) => ({ ...prev, [key]: state }));
  }, []);

  const stateOf = useCallback(
    (target: SlicerTarget): NormalizeState => states[normalizeStateKey(target)] ?? "idle",
    [states],
  );

  /** Resolves true when the slicer was launched, so a menu can close. */
  const open = useCallback(
    async (target: SlicerTarget): Promise<boolean> => {
      const stateKey = normalizeStateKey(target);
      const launch = () => {
        window.location.href = target.href;
        setState(stateKey, "idle");
        onOpened();
        return true;
      };
      const current = states[stateKey] ?? "idle";
      if (current === "ready") return launch();
      if (current === "preparing" || !target.plate) return false;

      setState(stateKey, "preparing");
      try {
        let { status } = await printsApi.normalizePlate(printId, target.plate.id, target.normalizeTarget);
        if (status === "ready") return launch();
        while (status === "preparing") {
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          if (!mounted.current) return false;
          ({ status } = await printsApi.normalizePlate(printId, target.plate.id, target.normalizeTarget));
        }
        if (status === "failed") throw new Error("Normalizing failed");
        setState(stateKey, "ready");
        return false;
      } catch (err) {
        setState(stateKey, "idle");
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else if (mounted.current) alert(t("models:detail.normalizeFailed"));
        return false;
      }
    },
    [states, printId, onOpened, onUnauthorized, setState, t],
  );

  return { stateOf, open };
}
