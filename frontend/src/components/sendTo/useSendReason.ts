import { useTranslation } from "react-i18next";
import type { SendOutcome } from "../../api/sendTargets";

/** Why a send or a test didn't go, in the user's language. */
export function useSendReason(): (outcome: Extract<SendOutcome, { ok: false }>) => string {
  const { t } = useTranslation("app");
  return (outcome) => t(`configuration.sendTo.reasons.${outcome.reason}`, { status: outcome.status ?? "" });
}
