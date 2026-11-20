import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { slicerProfile } from "../../adapter/slicers/index.generated";
import { printsApi } from "../../api/prints";
import { studioApi, studioExportPath, type StudioDesign, type StudioExport } from "../../api/studio";
import { SLICER_OPTIONS } from "../../constants/settingsOptions";
import { useSlicerSettings } from "../../hooks/useSlicerPreference";
import { useUserPrinters } from "../../hooks/useUserPrinters";
import { isBody, plateOf, studioPlates, topLevel } from "../../studio/document";
import { saveResponseToDisk } from "../../utils/downloadResponse";
import { slicerLaunchUrl } from "../../utils/slicerLaunch";

export function studioExportName(name: string) {
  return `${name.replace(/[\\/:*?"<>|]+/g, "-") || "design"}.3mf`;
}

export default function StudioSlicerDialog({
  design,
  activePlate,
  onClose,
  onError,
}: {
  design: StudioDesign;
  activePlate: string;
  onClose: () => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useTranslation("app");
  const { t: common } = useTranslation("common");
  const settings = useSlicerSettings();
  const { printers } = useUserPrinters();
  const [chosenSlicer, setChosenSlicer] = useState("");
  const [chosenPrinter, setChosenPrinter] = useState<string | null>(null);
  const [chosenPlate, setChosenPlate] = useState(activePlate);
  const [downloading, setDownloading] = useState(false);

  const supported = SLICER_OPTIONS.filter((option) => slicerProfile(option.id));
  const installed = supported.filter((option) => settings.slicers.includes(option.id));
  const options = installed.length ? installed : supported;
  const slicer = options.find((option) => option.id === (chosenSlicer || settings.slicer))?.id ?? options[0].id;
  const profile = slicerProfile(slicer);
  const compatible = profile?.targetsPrinter ? printers.filter((entry) => entry.presets[slicer]) : [];
  const printer = compatible.find((entry) => entry.printer.id === (chosenPrinter ?? settings.printers[slicer]));
  const bodies = topLevel(design.document)
    .filter(isBody)
    .filter((body) => body.visible);
  const used = new Set(bodies.map(plateOf));
  const plates = studioPlates(design.document).filter((plate) => used.has(plate.id));
  const plate = plates.find((entry) => entry.id === chosenPlate) ?? plates[0];
  const onePlate = profile?.reads !== "bambu" && plates.length > 1;
  const target: StudioExport = {
    slicer,
    ...(printer ? { printer: { id: printer.printer.id, nozzle: printer.nozzle } } : {}),
    ...(onePlate && plate ? { plate: plate.id } : {}),
  };
  const filename = studioExportName(onePlate ? `${design.name} - ${plate?.name ?? ""}` : design.name);
  const href = slicerLaunchUrl(
    slicer,
    printsApi.slicerFileUrl(studioExportPath(design.id, filename, target)),
    filename,
    settings.bridged,
  );

  const download = async () => {
    setDownloading(true);
    try {
      await saveResponseToDisk(await studioApi.export(design.id, filename, target), filename);
    } catch (error) {
      onError(error);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t("studio.plates.openSlicer")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            size="small"
            label={t("studio.plates.slicer")}
            value={slicer}
            onChange={(event) => {
              setChosenSlicer(event.target.value);
              setChosenPrinter(null);
            }}
          >
            {options.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          {compatible.length > 0 && (
            <TextField
              select
              size="small"
              label={t("studio.plates.printer")}
              value={printer?.printer.id ?? ""}
              onChange={(event) => setChosenPrinter(event.target.value)}
            >
              <MenuItem value="">{t("studio.plates.noPreset")}</MenuItem>
              {compatible.map((entry) => (
                <MenuItem key={entry.printer.id} value={entry.printer.id}>
                  {entry.printer.model} · {entry.nozzle}
                </MenuItem>
              ))}
            </TextField>
          )}
          {onePlate && (
            <TextField
              select
              size="small"
              label={t("studio.plates.label")}
              value={plate?.id ?? ""}
              helperText={t("studio.plates.oneAtATime")}
              onChange={(event) => setChosenPlate(event.target.value)}
            >
              {plates.map((entry) => (
                <MenuItem key={entry.id} value={entry.id}>
                  {entry.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {!bodies.length && <Typography variant="body2">{t("studio.design.nothingToExport")}</Typography>}
          {new Set(
            (onePlate ? bodies.filter((body) => plateOf(body) === plate?.id) : bodies).map(
              (body) => body.color ?? "#b0b0b0",
            ),
          ).size > 1 && (
            <Typography variant="body2" color="text.secondary">
              {t("studio.plates.matchFilaments")}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{common("cancel")}</Button>
        <Button disabled={downloading || !bodies.length} onClick={() => void download()}>
          {t("studio.plates.download3mf")}
        </Button>
        <Button variant="contained" disableElevation disabled={!bodies.length} href={href}>
          {t("studio.plates.open")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
