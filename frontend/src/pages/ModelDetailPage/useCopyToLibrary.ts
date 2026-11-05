import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { UnauthorizedError } from "../../api/client";
import type { Print } from "../../api/prints";
import { socialApi } from "../../api/social";
import { useToast } from "../../components/ToastProvider";

/** Copying another user's shared model into the user's own library, from its menu or its page. The copy is theirs:
 *  the original changing, going private or being deleted later leaves it as it is. `onCopied` hears the original
 *  again, now pointing at the copy. */
export function useCopyToLibrary(print: Print, onUnauthorized?: () => void, onCopied?: (print: Print) => void) {
  const { t } = useTranslation("models");
  const navigate = useNavigate();
  const showToast = useToast();
  const [copying, setCopying] = useState(false);

  const openCopy = (id: string) => navigate(`/models/${id}`);

  const copy = async () => {
    if (copying) return;
    setCopying(true);
    try {
      const { print: mine, copied } = await socialApi.copy(print.id);
      onCopied?.({ ...print, library_copy_id: mine.id });
      showToast({
        message: t(copied ? "shared.copied" : "shared.alreadyInLibrary", { name: mine.title || mine.name }),
        severity: copied ? "success" : "info",
        action: { label: t("shared.openCopy"), onClick: () => openCopy(mine.id) },
        autoHideMs: 8000,
      });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: err instanceof Error ? err.message : t("shared.copyFailed"), severity: "error" });
    } finally {
      setCopying(false);
    }
  };

  return { copying, copy, openCopy };
}
