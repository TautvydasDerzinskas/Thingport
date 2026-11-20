import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
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
import type { UserPrinter } from "../../api/printers";
import { studioApi, studioExportPath, type StudioDesign, type StudioExport } from "../../api/studio";
import { SLICER_OPTIONS } from "../../constants/settingsOptions";
import { useSlicerSettings } from "../../hooks/useSlicerPreference";
import { useUserPrinters } from "../../hooks/useUserPrinters";
import {
  isBody,
  plateOf,
  STUDIO_DEFAULT_BODY_COLOR,
  STUDIO_FILAMENT_MATERIALS,
  STUDIO_FILAMENT_SLOT_LIMIT,
  studioPlates,
  topLevel,
  type StudioFilamentSlot,
} from "../../studio/document";
import { saveResponseToDisk } from "../../utils/downloadResponse";
import { slicerLaunchUrl } from "../../utils/slicerLaunch";
import type { RunCommand } from "./useStudioDesign";

export function studioExportName(name: string) {
  return `${name.replace(/[\\/:*?"<>|]+/g, "-") || "design"}.3mf`;
}

export default function StudioSlicerDialog({
  design,
  activePlate,
  run,
  onClose,
  onError,
}: {
  design: StudioDesign;
  activePlate: string;
  run: RunCommand;
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
  const [slotDraft, setSlotDraft] = useState<StudioFilamentSlot[] | null>(null);
  const [savingSlots, setSavingSlots] = useState(false);

  const supported = SLICER_OPTIONS.filter((option) => slicerProfile(option.id));
  const installed = supported.filter((option) => settings.slicers.includes(option.id));
  const options = installed.length ? installed : supported;
  const slicer = options.find((option) => option.id === (chosenSlicer || settings.slicer))?.id ?? options[0].id;
  const profile = slicerProfile(slicer);
  const compatible = profile?.targetsPrinter ? printers.filter((entry) => entry.presets[slicer]) : [];
  const setup = design.document.print_setup;
  const supportsNozzle = (entry: UserPrinter, nozzle: string) =>
    entry.exact_nozzles?.[slicer]?.includes(nozzle) ??
    (entry.nozzle === nozzle || entry.printer.nozzles?.includes(nozzle));
  const printerChoices = compatible
    .filter((entry) => supportsNozzle(entry, entry.nozzle))
    .map(({ printer, nozzle }) => ({ key: `${printer.id}/${nozzle}`, printer, nozzle }));
  const checkedPrinter = compatible.find(({ printer }) => printer.id === setup?.printer);
  if (
    setup &&
    checkedPrinter &&
    setup.nozzle !== checkedPrinter.nozzle &&
    supportsNozzle(checkedPrinter, setup.nozzle)
  ) {
    printerChoices.unshift({
      key: `${setup.printer}/${setup.nozzle}`,
      printer: checkedPrinter.printer,
      nozzle: setup.nozzle,
    });
  }
  const defaultPrinter =
    setup && checkedPrinter
      ? `${setup.printer}/${setup.nozzle}`
      : printerChoices.find(({ printer }) => printer.id === settings.printers[slicer])?.key;
  const printer = printerChoices.find(({ key }) => key === (chosenPrinter ?? defaultPrinter));
  const bodies = topLevel(design.document)
    .filter(isBody)
    .filter((body) => body.visible);
  const used = new Set(bodies.map(plateOf));
  const plates = studioPlates(design.document).filter((plate) => used.has(plate.id));
  const plate = plates.find((entry) => entry.id === chosenPlate) ?? plates[0];
  const onePlate = profile?.reads !== "bambu" && plates.length > 1;
  const canAssignSlots = profile?.reads === "bambu";
  const colorsByPlate = new Map<string, Set<string>>();
  for (const body of onePlate ? bodies.filter((entry) => plateOf(entry) === plate?.id) : bodies) {
    const color = body.color?.toLowerCase() ?? STUDIO_DEFAULT_BODY_COLOR;
    if (!colorsByPlate.has(color)) colorsByPlate.set(color, new Set());
    colorsByPlate.get(color)!.add(plateOf(body));
  }
  const savedSlots = design.document.filament_slots ?? [];
  const tooManyColors = canAssignSlots && colorsByPlate.size > STUDIO_FILAMENT_SLOT_LIMIT;
  const slots = slotDraft ?? savedSlots;
  const missing = [...colorsByPlate.keys()].filter((color) => !slots.some((assignment) => assignment.color === color));
  const setSlot = (color: string, slot: number, material: StudioFilamentSlot["material"]) => {
    const other = slots.filter((assignment) => assignment.color !== color && (!slot || assignment.slot !== slot));
    setSlotDraft(slot ? [...other, { color, slot, material }] : other);
  };
  const saveSlots = async () => {
    const submitted = slotDraft;
    if (!submitted) return;
    setSavingSlots(true);
    try {
      if (await run("set_filament_slots", { slots: submitted }, { waitForSave: true }))
        setSlotDraft((latest) => (latest === submitted ? null : latest));
    } finally {
      setSavingSlots(false);
    }
  };
  const unsaved = canAssignSlots && slotDraft !== null;
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
    <Dialog open onClose={onClose} fullWidth maxWidth={canAssignSlots ? "sm" : "xs"}>
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
          {printerChoices.length > 0 && (
            <TextField
              select
              size="small"
              label={t("studio.plates.printer")}
              value={printer?.key ?? ""}
              onChange={(event) => setChosenPrinter(event.target.value)}
            >
              <MenuItem value="">{t("studio.plates.noPreset")}</MenuItem>
              {printerChoices.map((entry) => (
                <MenuItem key={entry.key} value={entry.key}>
                  {entry.printer.model} · {entry.nozzle}
                </MenuItem>
              ))}
            </TextField>
          )}
          {tooManyColors && (
            <Alert severity="error">{t("studio.print.tooManySlots", { limit: STUDIO_FILAMENT_SLOT_LIMIT })}</Alert>
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
          {!canAssignSlots && colorsByPlate.size > 1 && (
            <Typography variant="body2" color="text.secondary">
              {t("studio.plates.matchFilaments")}
            </Typography>
          )}
          {canAssignSlots && colorsByPlate.size > 0 && (
            <Stack spacing={1.5}>
              <Typography variant="subtitle2">{t("studio.print.filaments")}</Typography>
              {missing.length > 0 && (colorsByPlate.size > 1 || slots.length > 0) && (
                <Alert severity="warning">{t("studio.print.unmapped", { number: missing.length })}</Alert>
              )}
              {[...colorsByPlate].map(([color, required]) => {
                const assignment = slots.find((entry) => entry.color === color);
                return (
                  <Stack key={color} direction={{ xs: "column", sm: "row" }} alignItems={{ sm: "center" }} spacing={1}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
                      <Box
                        sx={{
                          width: 18,
                          height: 18,
                          bgcolor: color,
                          border: 1,
                          borderColor: "divider",
                          borderRadius: 0.5,
                          flexShrink: 0,
                        }}
                      />
                      <Box>
                        <Typography variant="body2">{color.toUpperCase()}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {plates
                            .filter((entry) => required.has(entry.id))
                            .map((entry) => entry.name)
                            .join(", ")}
                        </Typography>
                      </Box>
                    </Stack>
                    <TextField
                      select
                      size="small"
                      label={t("studio.print.slot")}
                      value={assignment?.slot ?? 0}
                      sx={{ minWidth: 128 }}
                      onChange={(event) => setSlot(color, Number(event.target.value), assignment?.material ?? "PLA")}
                    >
                      <MenuItem value={0}>{t("studio.print.automatic")}</MenuItem>
                      {Array.from({ length: STUDIO_FILAMENT_SLOT_LIMIT }, (_, index) => index + 1).map((slot) => (
                        <MenuItem
                          key={slot}
                          value={slot}
                          disabled={slots.some(
                            (entry) => entry.slot === slot && entry.color !== color && colorsByPlate.has(entry.color),
                          )}
                        >
                          {slot}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      size="small"
                      label={t("studio.print.material")}
                      value={assignment?.material ?? "PLA"}
                      disabled={!assignment}
                      sx={{ minWidth: 108 }}
                      onChange={(event) =>
                        assignment &&
                        setSlot(color, assignment.slot, event.target.value as StudioFilamentSlot["material"])
                      }
                    >
                      {STUDIO_FILAMENT_MATERIALS.map((material) => (
                        <MenuItem key={material} value={material}>
                          {material}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                );
              })}
              {unsaved && (
                <Button
                  size="small"
                  onClick={() => void saveSlots()}
                  disabled={savingSlots}
                  sx={{ alignSelf: "flex-start" }}
                >
                  {t("studio.print.saveSlots")}
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{common("cancel")}</Button>
        <Button disabled={downloading || !bodies.length || unsaved || tooManyColors} onClick={() => void download()}>
          {t("studio.plates.download3mf")}
        </Button>
        <Button
          variant="contained"
          disableElevation
          disabled={!bodies.length || unsaved || tooManyColors}
          href={unsaved || !bodies.length || tooManyColors ? undefined : href}
        >
          {t("studio.plates.open")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
