import { useTranslation } from "react-i18next";
import ModelPickerDialog from "../ModelPickerDialog";
import { toModel } from "../../sdk/userLibrary";
import type { SdkModel } from "../../sdk/types";

/** What a tool's `ui.pickModels()` asks. */
export type ModelPickQuestion = { title?: string; confirmLabel?: string; max?: number };

/** At most this many, so one call can't ask for the whole library. */
const MAX_PICK = 100;

export function pickLimit(max: unknown): number {
  return typeof max === "number" && Number.isFinite(max) ? Math.min(Math.max(1, Math.floor(max)), MAX_PICK) : 20;
}

/** The model picker a tool's `ui.pickModels()` opens: an empty list answers a cancel. */
export default function ToolModelPicker({
  question,
  onAnswer,
  onUnauthorized,
}: {
  question: (ModelPickQuestion & { id: number }) | null;
  onAnswer: (models: SdkModel[]) => void;
  onUnauthorized?: () => void;
}) {
  const { t } = useTranslation("app");
  if (!question) return null;
  return (
    <ModelPickerDialog
      key={question.id}
      title={question.title || t("tools.modelPicker.title")}
      confirmLabel={question.confirmLabel || t("tools.picker.choose")}
      max={pickLimit(question.max)}
      onClose={() => onAnswer([])}
      onPick={(prints) => onAnswer(prints.map(toModel))}
      onUnauthorized={onUnauthorized}
    />
  );
}
