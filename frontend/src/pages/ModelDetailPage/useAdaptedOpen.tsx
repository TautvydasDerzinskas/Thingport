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
import { saveBlobToDisk } from "../../utils/downloadResponse";
import { isAdaptedTarget, type AdaptedTarget, type SlicerTarget } from "./useOpenInSlicer";

export type AdaptState = "idle" | "preparing" | "ready";

const POLL_MS = 2000;

/** `<name>-adapted.3mf`, with the printer's model after it for a copy made for one: as Thingport Grab names its. */
export function adaptedCopyFilename(source: string, printerModel: string | null): string {
  const base = source.replace(/\.3mf$/i, "");
  const model = printerModel
    ?.replace(/[\\/:*?"<>|]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return `${base}-adapted${model ? `-${model}` : ""}.3mf`;
}

/** "Open adapted in <slicer>": asks the server for the copy that slicer gets and polls until it's made, so no
 *  request has to outlast a proxy timeout. A cached copy opens straight away. A slow one ends in "ready" and needs a
 *  second click: browsers only launch a slicer's protocol right after a click. `download` saves the copy instead, once
 *  made, which needs no second click. A target that asks which printer it's for asks first, in `dialog`, which the
 *  caller renders. */
export function useAdaptedOpen(
  printId: string,
  slicerId: string | null,
  onOpened: () => void,
  onUnauthorized?: () => void,
  onDownloaded?: () => void,
) {
  const { t } = useTranslation(["models"]);
  const showToast = useToast();
  const { printers } = useUserPrinters(onUnauthorized);
  const [states, setStates] = useState<Record<string, AdaptState>>({});
  // The copy picked for a target that asks, kept while it's made, so the second click opens it without asking again.
  const [picked, setPicked] = useState<Record<string, AdaptedTarget>>({});
  const [asked, setAsking] = useState<{
    /** The model it was asked for: the page header keeps this hook while another model loads. */
    printId: string;
    target: AdaptedTarget;
    action: "open" | "download";
    resolve: (done: boolean) => void;
  } | null>(null);
  // Never answered for another model: its plate with this one's id would be a copy of neither.
  const asking = asked?.printId === printId ? asked : null;
  useEffect(() => {
    if (!asked || asked.printId === printId) return;
    asked.resolve(false);
    setAsking(null);
  }, [asked, printId]);
  const [downloading, setDownloading] = useState(false);
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

  /** The user's printer a copy is made for, as the catalogue names it ("Bambu Lab P1S"); null for one that isn't. */
  const printerOf = useCallback(
    (target: AdaptedTarget) => {
      const choice = current(target).printer;
      return (choice && printers.find((printer) => printer.printer.id === choice.id)) ?? null;
    },
    [current, printers],
  );
  const printerName = useCallback(
    (target: AdaptedTarget): string | null => {
      const printer = printerOf(target);
      return printer ? `${printer.brandName} ${printer.printer.model}`.trim() : null;
    },
    [printerOf],
  );

  /** Saves the copy once it's made, or the file itself where the printer picked needs none. */
  const downloadNow = useCallback(
    async (target: AdaptedTarget | SlicerTarget, printerModel: string | null): Promise<boolean> => {
      if (!slicerId) return false;
      setDownloading(true);
      try {
        let url = target.url;
        let filename = target.filename;
        if (isAdaptedTarget(target) && target.plate) {
          const plateId = target.plate.id;
          const adapt = () => printsApi.adaptPlate(printId, plateId, slicerId, target.printer);
          let { status } = await adapt();
          while (status === "preparing") {
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
            if (!mounted.current) return false;
            ({ status } = await adapt());
          }
          // Left the page meanwhile, a cached copy's too: nothing is fetched or saved after that.
          if (!mounted.current) return false;
          if (status === "failed") throw new Error("Adapting failed");
          url = target.fileUrl;
          // The adapted link serves the plate itself where no copy is needed: then it's named as the plate is.
          if (status === "ready") filename = adaptedCopyFilename(target.filename, printerModel);
        }
        const res = await fetch(printsApi.fileUrl(url));
        if (res.status === 401) throw new UnauthorizedError();
        if (!res.ok) throw new Error("Download failed");
        const blob = await res.blob();
        if (!mounted.current) return false;
        // Named here: the server names a copy after its plate, as the original's own download is.
        await saveBlobToDisk(blob, filename);
        onDownloaded?.();
        return true;
      } catch (err) {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else if (mounted.current) showToast({ message: t("models:detail.downloadFailed"), severity: "warning" });
        return false;
      } finally {
        if (mounted.current) setDownloading(false);
      }
    },
    [printId, slicerId, onDownloaded, onUnauthorized, showToast, t],
  );

  /** Resolves true once saved. A target that asks which printer it's for asks first. */
  const download = useCallback(
    async (target: AdaptedTarget): Promise<boolean> => {
      const now = current(target);
      if (now.ask)
        return new Promise<boolean>((resolve) => setAsking({ printId, target, action: "download", resolve }));
      return downloadNow(now, printerOf(target)?.printer.model ?? null);
    },
    [current, downloadNow, printerOf, printId],
  );

  /** Resolves true when the slicer was launched, so a menu can close. */
  const open = useCallback(
    async (target: AdaptedTarget): Promise<boolean> => {
      const now = current(target);
      if (now.ask) return new Promise<boolean>((resolve) => setAsking({ printId, target, action: "open", resolve }));
      const launched = await openNow(now);
      if (launched && target.ask) forget(pickKey(target));
      return launched;
    },
    [current, openNow, forget, pickKey, printId],
  );

  const choose = async (printer: UserPrinter, remember: boolean) => {
    if (!asking) return;
    const { target, action, resolve } = asking;
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
    if (action === "download") return resolve(await downloadNow(chosen, printer.printer.model));
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

  return { stateOf, open, download, downloading, printerName, dialog };
}
