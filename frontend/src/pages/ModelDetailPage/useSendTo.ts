import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { UnauthorizedError } from "../../api/client";
import { sendTargetsApi, type SendTargetSummary } from "../../api/sendTargets";
import { useToast } from "../../components/ToastProvider";
import { takesFile } from "../../components/sendTo/sendKinds";
import { useSendReason } from "../../components/sendTo/useSendReason";
import { useSlicerSettings } from "../../hooks/useSlicerPreference";
import type { ModelFile } from "./useOpenInSlicer";

/** The tab a link reuses, if it's one: never a name the browser keeps for itself, like "_self", which is this tab. */
function namedTab(target: SendTargetSummary): string | null {
  if (target.kind !== "link" || target.open !== "named") return null;
  return target.tab && !target.tab.startsWith("_") ? target.tab : "thingport";
}

/** A tab for a link, opened in the click itself. A new one gets no hold on Thingport's page. A named one keeps it:
 *  without it the browser no longer finds that tab by its name, nor lets this page send it anywhere, so each send
 *  would open another. */
function tabFor(target: SendTargetSummary): Window | null {
  if (target.kind !== "link" || target.open === "same") return null;
  const name = namedTab(target);
  if (name) return window.open("about:blank", name);
  const tab = window.open("about:blank", "_blank");
  if (tab) tab.opener = null;
  return tab;
}

// The send each named tab is for now. Destinations can share one, and a send started later takes it over: an earlier
// one coming back then neither moves it nor closes it.
const tabSends = new Map<string, object>();

/**
 * The user's Send to destinations for the file picked on a model's page, split by where they show, and sending to
 * one. A link opens in the click itself (a tab opened after waiting for the server would be blocked as a pop-up), then
 * goes to the address the server filled in; a request reports back in a toast. None set up: nothing at all.
 */
export function useSendTo(printId: string, file: ModelFile | null, onUnauthorized?: () => void) {
  const { t } = useTranslation(["models", "app"]);
  const toast = useToast();
  const reasonText = useSendReason();
  const { sendTargets } = useSlicerSettings();
  // Each destination on its way, so one can't be sent twice at once and each finishes on its own.
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  // The model the page is on, null once it's left: a link that comes back for another opens nothing.
  const shown = useRef<string | null>(printId);
  useEffect(() => {
    shown.current = printId;
    return () => {
      shown.current = null;
    };
  }, [printId]);
  const offered = file ? sendTargets.filter((target) => takesFile(target.file_types, file.filename)) : [];

  const settle = (id: string, busy: boolean) => {
    if (busy) inFlight.current.add(id);
    else inFlight.current.delete(id);
    setSending(new Set(inFlight.current));
  };

  const send = async (target: SendTargetSummary) => {
    if (!file || inFlight.current.has(target.id)) return;
    const tab = tabFor(target);
    const name = namedTab(target);
    const claim = {};
    if (name) tabSends.set(name, claim);
    const ours = () => !name || tabSends.get(name) === claim;
    const drop = () => {
      if (ours()) tab?.close();
    };
    settle(target.id, true);
    try {
      const result = await sendTargetsApi.send(printId, target.id, file.key);
      if ("open" in result) {
        if (shown.current !== printId) return drop();
        // A later send has the tab: this one opens nothing, here or there.
        if (!ours()) return;
        // By how the server opens it now, as it may have been changed elsewhere since the page read it.
        if (tab && result.open.mode !== "same" && /^https?:/i.test(result.open.url)) {
          tab.location.replace(result.open.url);
        } else {
          drop();
          // An app's own address, or this tab.
          window.location.assign(result.open.url);
        }
        return;
      }
      drop();
      if (result.ok) {
        const thenOpen = result.then_open;
        toast({
          message: t("models:detail.sendTo.sent", { name: target.name }),
          severity: "success",
          ...(thenOpen
            ? {
                action: {
                  label: t("models:detail.sendTo.openAfter"),
                  onClick: () => window.open(thenOpen, "_blank", "noopener"),
                },
                autoHideMs: 8000,
              }
            : {}),
        });
      } else {
        toast({
          message: t("models:detail.sendTo.failed", { name: target.name, reason: reasonText(result) }),
          severity: "error",
        });
      }
    } catch (err) {
      drop();
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    } finally {
      if (name && ours()) tabSends.delete(name);
      settle(target.id, false);
    }
  };

  return {
    menu: offered.filter((target) => target.placement === "menu"),
    buttons: offered.filter((target) => target.placement === "button"),
    send,
    sending,
  };
}
