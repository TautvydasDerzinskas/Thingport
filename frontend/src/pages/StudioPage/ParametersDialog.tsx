import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { keyframes } from "@mui/material/styles";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import HelpTip from "../../components/HelpTip";
import type { StudioDocument } from "../../studio/document";
import Segmented from "../../components/controls/Segmented";
import {
  checkParameterName,
  expressionNames,
  PARAMETER_NAME_LENGTH,
  PARAMETER_UNITS,
  type ParameterUnit,
} from "../../studio/expressions";
import { NumberField } from "./fields";
import { featureLabel } from "./labels";
import type { RunCommand } from "./useStudioDesign";
import { useDesignUnits } from "./units";

// The design's parameters: named numbers its sizes can follow as formulas, each with its unit as in CAD (a length, an
// angle or none). Changing one here works every formula that uses it out again, as set_parameter does for an assistant.

const appear = keyframes`from { opacity: 0; transform: translateY(-4px); }`;

type Props = {
  open: boolean;
  doc: StudioDocument | null;
  run: RunCommand;
  onClose: () => void;
};

export default function ParametersDialog({ open, doc, run, onClose }: Props) {
  const { t } = useTranslation("app");
  const designUnits = useDesignUnits();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  // A new parameter starts in the design's units.
  const [unit, setUnit] = useState<ParameterUnit | null>(null);
  const newUnit = unit ?? designUnits;
  const parameters = doc?.parameters ?? [];
  const unitOptions = PARAMETER_UNITS.map((each) => ({
    value: each,
    label: each === "deg" ? "°" : each === "none" ? t("studio.parameters.noUnit") : each,
  }));

  // Which fields follow each parameter, as "Box 1 width".
  const uses = useMemo(() => {
    const found = new Map<string, string[]>();
    for (const feature of doc?.features ?? [])
      for (const [field, expression] of Object.entries(feature.expressions ?? {})) {
        let names: string[] = [];
        try {
          names = expressionNames(expression);
        } catch {
          // A formula that can't be read uses nothing.
        }
        for (const each of names) found.set(each, [...(found.get(each) ?? []), `${featureLabel(feature, t)} ${field}`]);
      }
    return found;
  }, [doc, t]);

  const typed = Number(value.replace(",", "."));
  const nameProblem = (() => {
    if (!name) return null;
    if (parameters.some((parameter) => parameter.name === name)) return t("studio.parameters.taken");
    try {
      checkParameterName(name);
      return null;
    } catch {
      return t("studio.parameters.badName");
    }
  })();
  const canAdd = Boolean(name) && !nameProblem && value.trim() !== "" && Number.isFinite(typed);
  const add = async () => {
    if (!canAdd) return;
    if ((await run("set_parameter", { name, value: typed, unit: newUnit })) === null) return;
    setName("");
    setValue("");
    setUnit(null);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        {t("studio.parameters.title")}
        <HelpTip text={t("studio.parameters.help")} />
      </DialogTitle>
      <DialogContent>
        {parameters.length ? (
          <Stack component="ul" spacing={1} sx={{ listStyle: "none", m: 0, p: 0, pt: 1 }}>
            {parameters.map((parameter) => {
              const usedBy = uses.get(parameter.name) ?? [];
              const deleteLabel = t("studio.parameters.delete", { name: parameter.name });
              return (
                <Stack
                  component="li"
                  key={parameter.name}
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{
                    animation: `${appear} 180ms ease-out`,
                    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                      {parameter.name}
                    </Typography>
                    <Tooltip title={usedBy.join(", ")} disableHoverListener={!usedBy.length}>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                        {usedBy.length
                          ? t("studio.parameters.uses", { count: usedBy.length })
                          : t("studio.parameters.unused")}
                      </Typography>
                    </Tooltip>
                  </Box>
                  <Box sx={{ width: 110 }}>
                    <NumberField
                      label={t("studio.parameters.value")}
                      value={parameter.value}
                      onCommit={(next) => void run("set_parameter", { name: parameter.name, value: next })}
                    />
                  </Box>
                  {/* The number stays as it is: switching mm to in makes it that many inches, as retyping it would. */}
                  <Segmented
                    label={t("studio.parameters.unitOf", { name: parameter.name })}
                    value={parameter.unit ?? "mm"}
                    options={unitOptions}
                    onChange={(next) =>
                      void run("set_parameter", { name: parameter.name, value: parameter.value, unit: next })
                    }
                  />
                  {/* One a formula uses can't go: what uses it is said on hover. */}
                  <Tooltip title={usedBy.length ? t("studio.parameters.inUse") : deleteLabel}>
                    <span>
                      <IconButton
                        size="small"
                        aria-label={deleteLabel}
                        disabled={usedBy.length > 0}
                        onClick={() => void run("delete_parameter", { name: parameter.name })}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              );
            })}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
            {t("studio.parameters.none")}
          </Typography>
        )}
        <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mt: 2.5 }}>
          <TextField
            size="small"
            label={t("studio.parameters.name")}
            placeholder="clearance"
            value={name}
            onChange={(event) => setName(event.target.value.trim())}
            onKeyDown={(event) => event.key === "Enter" && void add()}
            error={Boolean(nameProblem)}
            helperText={nameProblem ?? " "}
            slotProps={{
              htmlInput: { maxLength: PARAMETER_NAME_LENGTH, spellCheck: false, style: { fontFamily: "monospace" } },
              inputLabel: { shrink: true },
            }}
            sx={{ flex: 1, "& input": { py: 0.75, fontSize: "0.85rem" } }}
          />
          <TextField
            size="small"
            label={t("studio.parameters.value")}
            placeholder="2"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void add()}
            slotProps={{ htmlInput: { inputMode: "decimal" }, inputLabel: { shrink: true } }}
            sx={{ width: 110, "& input": { py: 0.75, fontSize: "0.85rem" } }}
          />
          <Segmented label={t("studio.parameters.unit")} value={newUnit} options={unitOptions} onChange={setUnit} />
          <Tooltip title={t("studio.parameters.add")}>
            <span>
              <IconButton aria-label={t("studio.parameters.add")} disabled={!canAdd} onClick={() => void add()}>
                <AddRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t("close", { ns: "common" })}</Button>
      </DialogActions>
    </Dialog>
  );
}
