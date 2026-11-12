import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { UnauthorizedError } from "../../api/client";
import { printsApi } from "../../api/prints";
import type { UserPrinter } from "../../api/printers";
import { settingsApi } from "../../api/settings";
import PrinterAskDialog from "../../components/printers/PrinterAskDialog";
import { useToast } from "../../components/ToastProvider";
import { SLICER_OPTIONS } from "../../constants/settingsOptions";
import { setCachedSlicerSettings } from "../../hooks/useSlicerPreference";
import { useUserPrinters } from "../../hooks/useUserPrinters";
import { isAdaptedTarget, type AdaptedTarget } from "./useOpenInSlicer";

export type AdaptState = "idle" | "preparing" | "ready";

const POLL_MS = 2000;

/** "Open adapted in <slicer>": asks the server for the copy that slicer gets and polls until it's made, so no
 *  request has to outlast a proxy timeout. A cached copy opens straight away. A slow one ends in "ready" and needs a
 *  second click: browsers only launch a slicer's protocol right after a click. A target that asks which printer it's
 *  for asks first, in `dialog`, which the caller renders. */
export function useAdaptedOpen(
  printId: string,
  slicerId: string | null,
  onOpened: () => void,
  onUnauthorized?: () => void,
) {
  const { t } = useTranslation(["models"]);
  const showToast = useToast();
  const { printers } = useUserPrinters(onUnauthorized);
  const [states, setStates] = useState<Record<string, AdaptState>>({});
  // The copy picked for a target that asks, kept while it's made, so the second click opens it without asking again.
  const [picked, setPicked] = useState<Record<string, AdaptedTarget>>({});
  const [asking, setAsking] = useState<{ target: AdaptedTarget; resolve: (launched: boolean) => void } | null>(null);
  // Set on every mount: StrictMode unmounts and remounts once in development.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A copy is made for one slicer and printer: switching either starts again.
  const keyOf = useCallback(
    (target: AdaptedTarget) =>
      `${slicerId ?? ""}:${target.printer ? `${target.printer.id}@${target.printer.nozzle}` : ""}:${target.key}`,
    [slicerId],
  );
  // A pick is the slicer's: after switching slicers the target asks again.
  const pickKey = useCallback((target: AdaptedTarget) => `${slicerId ?? ""}:${target.key}`, [slicerId]);
  const current = useCallback(
    (target: AdaptedTarget) => (target.ask ? (picked[pickKey(target)] ?? target) : target),
    [picked, pickKey],
  );

  const setState = useCallback((key: string, state: AdaptState) => {
    if (mounted.current) setStates((prev) => ({ ...prev, [key]: state }));
  }, []);

  const stateOf = useCallback(
    (target: AdaptedTarget): AdaptState => states[keyOf(current(target))] ?? "idle",
    [states, keyOf, current],
  );

  const openNow = useCallback(
    async (target: AdaptedTarget): Promise<boolean> => {
      const key = keyOf(target);
      const launch = () => {
        window.location.href = target.href;
        setState(key, "idle");
        onOpened();
        return true;
      };
      const state = states[key] ?? "idle";
      if (state === "ready") return launch();
      if (state === "preparing" || !target.plate || !slicerId) return false;

      setState(key, "preparing");
      try {
        const adapt = () => printsApi.adaptPlate(printId, target.plate!.id, slicerId, target.printer);
        let { status } = await adapt();
        // The adapted link serves the plate itself when no copy is needed, so either opens it.
        if (status === "ready" || status === "original") return launch();
        while (status === "preparing") {
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          if (!mounted.current) return false;
          ({ status } = await adapt());
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

  const forget = useCallback((key: string) => {
    setPicked((prev) => {
      const { [key]: _gone, ...rest } = prev;
      return rest;
    });
  }, []);

  /** Resolves true when the slicer was launched, so a menu can close. */
  const open = useCallback(
    async (target: AdaptedTarget): Promise<boolean> => {
      const now = current(target);
      if (now.ask) return new Promise<boolean>((resolve) => setAsking({ target, resolve }));
      const launched = await openNow(now);
      if (launched && target.ask) forget(pickKey(target));
      return launched;
    },
    [current, openNow, forget, pickKey],
  );

  const choose = async (printer: UserPrinter, remember: boolean) => {
    if (!asking) return;
    const { target, resolve } = asking;
    setAsking(null);
    const chosen = target.withPrinter?.(printer) ?? null;
    if (!chosen) return resolve(false);
    if (remember && slicerId) {
      settingsApi
        .updateSlicer({ printer: { slicer: slicerId, printer: printer.printer.id } })
        .then(setCachedSlicerSettings)
        .catch((err: unknown) => {
          if (err instanceof UnauthorizedError) onUnauthorized?.();
        });
    }
    // Made for that very printer: the file opens as it is, as Open opens it.
    if (!isAdaptedTarget(chosen)) {
      window.location.href = chosen.href;
      onOpened();
      return resolve(true);
    }
    setPicked((prev) => ({ ...prev, [pickKey(target)]: chosen }));
    const launched = await openNow(chosen);
    if (launched) forget(pickKey(target));
    resolve(launched);
  };

  const dialog = slicerId ? (
    <PrinterAskDialog
      open={Boolean(asking)}
      slicerId={slicerId}
      slicerLabel={SLICER_OPTIONS.find((option) => option.id === slicerId)?.label ?? slicerId}
      printers={printers}
      onCancel={() => {
        asking?.resolve(false);
        setAsking(null);
      }}
      onOpen={(printer, remember) => void choose(printer, remember)}
    />
  ) : null;

  return { stateOf, open, dialog };
}
