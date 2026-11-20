import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { arrangeMeasures, CommandError, previewArrangement, type Bounds } from "../../studio/commands";
import { featureById, MAX_PLATES, studioPlates, type StudioDocument } from "../../studio/document";
import { bedOutline, DEFAULT_PRINT_BED } from "../../studio/printLayout";
import { NumberField } from "./fields";
import { measureBoundsInWorker } from "./geometryClient";
import { featureLabel } from "./labels";
import type { RunCommand } from "./useStudioDesign";

export default function ArrangeDialog({
  designId,
  doc,
  plateId,
  run,
  onClose,
}: {
  designId: string;
  doc: StudioDocument;
  plateId: string;
  run: RunCommand;
  onClose: () => void;
}) {
  const { t } = useTranslation("app");
  const { t: common } = useTranslation("common");
  const [spacing, setSpacing] = useState(3);
  const [overflow, setOverflow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [measured, setMeasured] = useState<{ doc: StudioDocument; bounds?: Record<string, Bounds>; error?: Error }>();
  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => measureBoundsInWorker(designId, doc, arrangeMeasures(doc, { plate_id: plateId })))
      .then(
        (bounds) => {
          if (active) setMeasured({ doc, bounds });
        },
        (error: Error) => {
          if (active) setMeasured({ doc, error });
        },
      );
    return () => {
      active = false;
    };
  }, [designId, doc, plateId]);
  const bounds = measured?.doc === doc ? measured.bounds : undefined;
  const error = measured?.doc === doc ? measured.error : undefined;
  const preview = useMemo(
    () => (bounds ? previewArrangement(doc, { plate_id: plateId, spacing }, bounds) : null),
    [doc, plateId, spacing, bounds],
  );
  const bed = doc.print_setup?.bed ?? DEFAULT_PRINT_BED;
  const polygon = bedOutline(bed, doc.print_setup?.outline)
    .map(([x, y]) => `${(0.5 + x / bed[0]) * 100}% ${(0.5 - y / bed[1]) * 100}%`)
    .join(", ");
  const label = (id: string) => featureLabel(featureById(doc, id)!, t);
  const n = preview?.planes.length ?? 0;
  const room = n + studioPlates(doc).length - 1 <= MAX_PLATES;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t("studio.print.arrange")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <NumberField
              label={t("studio.print.spacing")}
              value={spacing}
              unit="mm"
              live
              validate={(value) => value >= 0 && value <= 100}
              onCommit={setSpacing}
            />
            <FormControlLabel
              control={<Checkbox checked={overflow} onChange={(_, checked) => setOverflow(checked)} />}
              label={t("studio.print.overflow")}
            />
          </Stack>
          {error && (
            <Alert severity="error">
              {error instanceof CommandError && error.code === "studio_arrange_empty"
                ? t("studio.print.arrangeEmpty")
                : error.message}
            </Alert>
          )}
          {preview?.overflow.length ? (
            <Alert severity="warning">
              {t("studio.print.tooLarge", { parts: preview.overflow.map(label).join(", ") })}
            </Alert>
          ) : null}
          {n > 1 && (!overflow || !room) && (
            <Alert severity="warning">{room ? t("studio.print.needsOverflow") : t("studio.print.plateLimit")}</Alert>
          )}
          {preview && (
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 2 }}>
              {preview.planes.map((placements, i) => (
                <Box key={i === 0 ? plateId : placements.map((part) => part.id).join("/")}>
                  <Typography variant="caption">
                    {i === 0
                      ? studioPlates(doc).find((plate) => plate.id === plateId)?.name
                      : t("studio.print.previewPlate", { number: i + 1 })}
                  </Typography>
                  <Box
                    sx={{
                      position: "relative",
                      aspectRatio: bed[0] / bed[1],
                      bgcolor: "action.hover",
                      clipPath: `polygon(${polygon})`,
                    }}
                  >
                    {placements.map((part, index) => (
                      <Box
                        key={part.id}
                        title={label(part.id)}
                        sx={{
                          position: "absolute",
                          left: `${(0.5 + part.x / bed[0]) * 100}%`,
                          bottom: `${(0.5 + part.y / bed[1]) * 100}%`,
                          width: `${(part.width / bed[0]) * 100}%`,
                          height: `${(part.depth / bed[1]) * 100}%`,
                          color: "text.primary",
                          display: "grid",
                          placeItems: "center",
                          overflow: "hidden",
                          fontSize: 10,
                          bgcolor: part.locked ? "action.selected" : "primary.main",
                          border: 1,
                          borderColor: "divider",
                        }}
                      >
                        {index + 1}
                      </Box>
                    ))}
                  </Box>
                  <Typography variant="caption" component="div" color="text.secondary">
                    {placements.map((part, index) => `${index + 1}. ${label(part.id)}`).join(" · ")}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{common("cancel")}</Button>
        <Button
          variant="contained"
          disabled={saving || !preview || Boolean(preview.overflow.length) || (!overflow && n > 1) || !room}
          onClick={async () => {
            setSaving(true);
            try {
              if (await run("arrange_plate", { plate_id: plateId, spacing, overflow })) onClose();
            } finally {
              setSaving(false);
            }
          }}
        >
          {t("studio.print.arrange")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
