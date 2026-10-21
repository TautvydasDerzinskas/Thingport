import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { UnauthorizedError } from "../../../api/client";
import { printsApi, type PrintQuality } from "../../../api/prints";
import { useToast } from "../../../components/ToastProvider";
import { worstSeverity } from "../../../components/QualitySeverityChip";

const POLL_MS = 800;

/** A check that finished while the page was open, for the overlay's closing beat. */
export type QualityOutcome = "good" | "issues" | null;

/** Reads the model's printability check and, the first time it's opened with checks on, runs it and follows along. */
export function useQualityCheck(printId: string, onUnauthorized?: () => void) {
  const { t } = useTranslation("models");
  const showToast = useToast();
  // Tagged with their print, so a newly opened model never shows the last one's result for a render.
  const [quality, setQuality] = useState<{ printId: string; value: PrintQuality } | null>(null);
  const [outcome, setOutcome] = useState<{ printId: string; value: QualityOutcome } | null>(null);
  // Kept out of the effect's deps: a new toast function or translation mustn't restart a running check.
  const notify = useRef({ showToast, t, onUnauthorized });
  useEffect(() => {
    notify.current = { showToast, t, onUnauthorized };
  }, [showToast, t, onUnauthorized]);

  useEffect(() => {
    if (!printId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setQuality(null);
    setOutcome(null);

    const settle = (next: PrintQuality, watched: boolean) => {
      setQuality({ printId, value: next });
      if (next.status === "checking") {
        timer = setTimeout(() => void poll(), POLL_MS);
        return;
      }
      if (!watched || (next.status !== "good" && next.status !== "issues")) return;
      setOutcome({ printId, value: next.status });
      if (next.status === "issues") {
        // Only minor problems, which slicers usually cope with: a note rather than a warning.
        const minor = worstSeverity(next) === "minor";
        notify.current.showToast({
          message: notify.current.t(minor ? "detail.quality.toastMinor" : "detail.quality.toastIssues"),
          severity: minor ? "info" : "warning",
        });
      }
    };
    const fail = (err: unknown) => {
      if (cancelled) return;
      if (err instanceof UnauthorizedError) notify.current.onUnauthorized?.();
      // Otherwise the check just doesn't show: it's an extra, not something to raise an error over.
      else console.error(err);
    };
    const poll = async () => {
      try {
        const next = await printsApi.getQuality(printId);
        if (!cancelled) settle(next, true);
      } catch (err) {
        fail(err);
      }
    };

    (async () => {
      try {
        let current = await printsApi.getQuality(printId);
        if (cancelled || !current.enabled) return;
        const watched = current.status === "unchecked" || current.status === "checking";
        if (current.status === "unchecked") current = await printsApi.startQuality(printId);
        if (!cancelled) settle(current, watched);
      } catch (err) {
        fail(err);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [printId]);

  return {
    quality: quality?.printId === printId ? quality.value : null,
    outcome: outcome?.printId === printId ? outcome.value : null,
  };
}
