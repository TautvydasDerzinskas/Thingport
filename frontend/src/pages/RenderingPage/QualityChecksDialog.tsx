import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { QUALITY_CHECK_KEYS, QUALITY_CHECK_SEVERITY, type QualityCheckKey } from "../../api/settings";
import QualitySeverityChip from "../../components/QualitySeverityChip";
import QualityCheckTile from "../../components/QualityCheckTile";

type Props = {
  open: boolean;
  checksOff: QualityCheckKey[];
  onChange: (checksOff: QualityCheckKey[]) => void;
  onClose: () => void;
};

/** One switch per kind of print problem. Each saves as soon as it's switched. */
export default function QualityChecksDialog({ open, checksOff, onChange, onClose }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const toggle = (key: QualityCheckKey, on: boolean) =>
    onChange(on ? checksOff.filter((off) => off !== key) : [...checksOff, key]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("adminSettings.rendering.quality.dialogTitle")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t("adminSettings.rendering.quality.dialogHint")}
        </Typography>
        <Stack divider={<Divider flexItem />}>
          {QUALITY_CHECK_KEYS.map((key) => {
            const titleId = `quality-check-${key}`;
            return (
              <Stack key={key} direction="row" spacing={2} alignItems="center" sx={{ py: 1.25 }}>
                <QualityCheckTile check={key} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.25 }}>
                    <Typography id={titleId} variant="body2" fontWeight={600}>
                      {t(`adminSettings.rendering.quality.checks.${key}.title`)}
                    </Typography>
                    <QualitySeverityChip severity={QUALITY_CHECK_SEVERITY[key]} />
                  </Stack>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {t(`adminSettings.rendering.quality.checks.${key}.desc`)}
                  </Typography>
                </Box>
                <Switch
                  checked={!checksOff.includes(key)}
                  onChange={(e) => toggle(key, e.target.checked)}
                  slotProps={{ input: { "aria-labelledby": titleId } }}
                />
              </Stack>
            );
          })}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
