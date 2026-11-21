import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import type { StudioPlate } from "../../studio/document";
import { plateLabel } from "./labels";
import { StudioProgress } from "./StudioModelImport";
import type { RunCommand } from "./useStudioDesign";

type LoadStatus = "loading" | "failed" | "loaded";

/** A plate selection starts one command. A plate restored by Undo waits for an explicit reload. */
export function useSourcePlate(
  designId: string | null,
  plate: StudioPlate | undefined,
  loadWasUndone: boolean,
  run: RunCommand,
  onSingleBody: (hint: { design: string; mesh: string }) => void,
) {
  const plateId = plate?.id;
  const archiveId = plate?.source?.archive_id;
  const key = designId && plateId && archiveId ? `${designId}/${plateId}/${archiveId}` : null;
  const loading = useRef(new Set<string>());
  const [loads, setLoads] = useState<Record<string, LoadStatus>>({});
  const status = key ? (loads[key] ?? (loadWasUndone ? "loaded" : undefined)) : undefined;
  const prepare = useCallback(() => {
    if (!designId || !plateId || !key || loading.current.has(key)) return;
    loading.current.add(key);
    setLoads((states) => ({ ...states, [key]: "loading" }));
    void run("load_source_plate", { plate_id: plateId }).then((created) => {
      loading.current.delete(key);
      setLoads((states) => ({ ...states, [key]: created ? "loaded" : "failed" }));
      if (created?.length === 1) onSingleBody({ design: designId, mesh: created[0] });
    });
  }, [designId, key, onSingleBody, plateId, run]);
  useEffect(() => {
    if (key && !status) prepare();
  }, [key, prepare, status]);
  return { status, prepare };
}

export default function StudioSourcePlate({
  plate,
  status,
  prepare,
}: {
  plate: StudioPlate;
  status?: LoadStatus;
  prepare: () => void;
}) {
  const { t } = useTranslation(["app", "common"]);
  const name = plateLabel(plate, t);
  return (
    <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", p: 2 }}>
      {status === "failed" ? (
        <Box sx={{ textAlign: "center" }}>
          <Typography role="alert">{t("studio.importModel.plateFailed", { name })}</Typography>
          <Button onClick={prepare}>{t("common:retry")}</Button>
        </Box>
      ) : status === "loaded" ? (
        <Button onClick={prepare}>{t("studio.importModel.loadPlate")}</Button>
      ) : (
        <StudioProgress message={t("studio.importModel.platePreparing", { name })} />
      )}
    </Box>
  );
}
