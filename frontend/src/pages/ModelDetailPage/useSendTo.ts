import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UnauthorizedError } from "../../api/client";
import { sendTargetsApi, type SendTargetSummary } from "../../api/sendTargets";
import { useToast } from "../../components/ToastProvider";
import { takesFile } from "../../components/sendTo/sendKinds";
import { useSendReason } from "../../components/sendTo/useSendReason";
import { useSlicerSettings } from "../../hooks/useSlicerPreference";
import type { ModelFile } from "./useOpenInSlicer";

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
  const [sending, setSending] = useState<string | null>(null);
  const offered = file ? sendTargets.filter((target) => takesFile(target.file_types, file.filename)) : [];

  const send = async (target: SendTargetSummary) => {
    if (!file) return;
    // Opened now, while the click still allows it; pointed at the link once it comes back.
    const tab =
      target.kind === "link" && target.open !== "same"
        ? window.open("about:blank", target.open === "named" ? (target.tab ?? "thingport") : "_blank")
        : null;
    setSending(target.id);
    try {
      const result = await sendTargetsApi.send(printId, target.id, file.key);
      if ("open" in result) {
        const web = /^https?:/i.test(result.open.url);
        if (tab && web) {
          // The page it opens gets no hold on Thingport's.
          tab.opener = null;
          tab.location.replace(result.open.url);
        } else {
          tab?.close();
          // An app's own address, or this tab.
          window.location.assign(result.open.url);
        }
        return;
      }
      tab?.close();
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
      tab?.close();
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    } finally {
      setSending(null);
    }
  };

  return {
    menu: offered.filter((target) => target.placement === "menu"),
    buttons: offered.filter((target) => target.placement === "button"),
    send,
    sending,
  };
}
