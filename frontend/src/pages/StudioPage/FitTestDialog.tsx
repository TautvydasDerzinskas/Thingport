import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { SplitFeature } from "../../studio/document";
import { checkParameterName } from "../../studio/expressions";
import { NumberField } from "./fields";
import type { RunCommand } from "./useStudioDesign";

export default function FitTestDialog({
  joint,
  run,
  onCreated,
  onClose,
}: {
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
  const [parameter, setParameter] = useState(() => {
    const expression = joint.expressions?.["connector.clearance"]?.trim();
    if (expression) {
      try {
        checkParameterName(expression);
        return expression;
      } catch {
        /* Use a new parameter for a clearance that now follows a formula. */
      }
    }
    return `fit_clearance_${joint.source_id.split("-").at(-1)}`;
  });
  const [working, setWorking] = useState(false);
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const create = async () => {
    setWorking(true);
    try {
      const args = { feature_id: joint.id, clearances: variants, name: t("studio.print.fitPlate") };
      const made = await run("make_fit_test", args);
      if (made && active.current) onCreated(made);
    } finally {
      if (active.current) setWorking(false);
    }
  };
  const apply = async () => {
    setWorking(true);
    try {
      if (
        (await run(
          "apply_fit_clearance",
          {
            feature_id: joint.id,
            clearance: chosen,
            parameter: parameter.trim() || undefined,
          },
          { waitForSave: true },
        )) &&
        active.current
      )
        onClose();
    } finally {
      if (active.current) setWorking(false);
    }
  };
  return (
    <Dialog open onClose={working ? undefined : onClose} fullWidth maxWidth="sm" disableEscapeKeyDown={working}>
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
                validate={(next) => next >= 0 && next <= 5}
                onCommit={(next) => setVariants((values) => values.map((each, j) => (i === j ? next : each)))}
              />
            ))}
          </Box>
          <Button variant="outlined" disabled={working} onClick={() => void create()}>
            {t("studio.print.makeFitPlate")}
          </Button>
          <Typography variant="subtitle2">{t("studio.print.useFit")}</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <NumberField
              label={t("studio.print.clearance")}
              value={chosen}
              unit="mm"
              validate={(next) => next >= 0 && next <= 5}
              onCommit={setChosen}
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
        <Button onClick={onClose} disabled={working}>
          {common("cancel")}
        </Button>
        <Button variant="contained" disabled={working} onClick={() => void apply()}>
          {t("studio.print.useFit")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
