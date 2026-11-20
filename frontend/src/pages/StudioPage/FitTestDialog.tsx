import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { applyCommand } from "../../studio/commands";
import type { SplitFeature, StudioDocument } from "../../studio/document";
import { DEFAULT_PRINT_BED, onBed } from "../../studio/printLayout";
import { NumberField } from "./fields";
import { measureBoundsInWorker } from "./geometryClient";
import type { RunCommand } from "./useStudioDesign";

export default function FitTestDialog({
  designId,
  doc,
  joint,
  run,
  onCreated,
  onClose,
}: {
  designId: string;
  doc: StudioDocument;
  joint: SplitFeature;
  run: RunCommand;
  onCreated: (ids: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("app");
  const { t: common } = useTranslation("common");
  const clearance = joint.connector?.clearance ?? 0.2;
  const start = Math.max(0, Math.min(4.8, clearance - 0.1));
  const [variants, setVariants] = useState([start, start + 0.1, start + 0.2]);
  const [chosen, setChosen] = useState(clearance);
  const [parameter, setParameter] = useState(
    joint.expressions?.["connector.clearance"] ?? `fit_clearance_${joint.source_id.split("-").at(-1)}`,
  );
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    setWorking(true);
    setError("");
    try {
      const args = { feature_id: joint.id, clearances: variants, name: t("studio.print.fitPlate") };
      const preview = applyCommand(doc, "make_fit_test", args);
      const bounds = await measureBoundsInWorker(designId, preview.document, preview.created);
      const { bed = DEFAULT_PRINT_BED, outline } = doc.print_setup ?? {};
      if (
        Object.values(bounds).some(
          ({ min, max }) =>
            max[2] > bed[2] || ![min[0], max[0]].every((x) => [min[1], max[1]].every((y) => onBed(x, y, bed, outline))),
        )
      ) {
        setError(t("studio.print.fitOutside"));
        return;
      }
      const made = await run("make_fit_test", args, { waitForSave: true });
      if (made) onCreated(made);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setWorking(false);
    }
  };
  const apply = async () => {
    setWorking(true);
    try {
      if (
        await run(
          "apply_fit_clearance",
          {
            feature_id: joint.id,
            clearance: chosen,
            parameter: parameter.trim() || undefined,
          },
          { waitForSave: true },
        )
      )
        onClose();
    } finally {
      setWorking(false);
    }
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t("studio.print.fitPlate")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2">{t("studio.print.fitHelp")}</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }}>
            {[1, 2, 3].map((number, i) => (
              <NumberField
                key={number}
                label={t("studio.print.variant", { number })}
                value={variants[i]}
                unit="mm"
                onCommit={(next) =>
                  next >= 0 && next <= 5 && setVariants((values) => values.map((each, j) => (i === j ? next : each)))
                }
              />
            ))}
          </Box>
          <Button variant="outlined" disabled={working} onClick={() => void create()}>
            {t("studio.print.makeFitPlate")}
          </Button>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="subtitle2">{t("studio.print.useFit")}</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <NumberField
              label={t("studio.print.clearance")}
              value={chosen}
              unit="mm"
              onCommit={(next) => next >= 0 && next <= 5 && setChosen(next)}
            />
            <TextField
              label={t("studio.print.clearanceParameter")}
              value={parameter}
              onChange={(event) => setParameter(event.target.value)}
              size="small"
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{common("cancel")}</Button>
        <Button variant="contained" disabled={working} onClick={() => void apply()}>
          {t("studio.print.useFit")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
