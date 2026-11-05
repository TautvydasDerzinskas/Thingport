import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { UnauthorizedError } from "../../api/client";
import type { Plate, Print } from "../../api/prints";
import { useToast } from "../../components/ToastProvider";
import { MODEL_EXTS } from "../../constants/fileTypes";
import { useStudioEnabled } from "../../hooks/useStudioEnabled";
import { extOf } from "../../utils/fileExtensions";
import { openModelAsDesign, type StudioArrival } from "../StudioPage/openModel";

// Opening a model's 3D file in Thingport Studio as a new design, while the instance has Studio on: from the model's
// page, and from its menu wherever the model is a tile.

export function useOpenInStudio(print: Print, onUnauthorized?: () => void) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const showToast = useToast();
  const studioEnabled = useStudioEnabled() === true;
  const [opening, setOpening] = useState(false);
  /** The model's files Studio can open, in the model's order; none while Studio is off. */
  const files = studioEnabled
    ? print.plates.filter((plate) => MODEL_EXTS.has(extOf(plate.filename).toLowerCase()))
    : [];

  const open = async (plate: Plate) => {
    setOpening(true);
    try {
      const design = await openModelAsDesign(
        { id: print.id, title: print.title || print.name },
        plate.id,
        t("studio.design.untitled"),
      );
      navigate(`/studio?design=${encodeURIComponent(design.id)}`, {
        state: { imported: design.mesh ?? undefined } satisfies StudioArrival,
      });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
      setOpening(false);
    }
  };

  return { files, opening, open };
}
