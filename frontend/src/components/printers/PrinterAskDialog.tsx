import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import type { UserPrinter } from "../../api/printers";
import PrinterPicture from "./PrinterPicture";

type Props = {
  open: boolean;
  slicerId: string;
  slicerLabel: string;
  printers: UserPrinter[];
  onCancel: () => void;
  onOpen: (printer: UserPrinter, remember: boolean) => void;
};

const PICTURE = 80;

/** Asked when a model opens adapted in a slicer with no printer remembered for it: the user's printers as picture
 *  cards, the slicer's printer remembered unless they untick it. */
export default function PrinterAskDialog({ open, slicerId, slicerLabel, printers, onCancel, onOpen }: Props) {
  const { t } = useTranslation(["models"]);
  const usable = (p: UserPrinter) => Boolean(p.presets[slicerId]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);

  // Chosen afresh each time it opens.
  useEffect(() => {
    if (!open) return;
    setChosen(printers.find((p) => Boolean(p.presets[slicerId]))?.printer.id ?? null);
    setRemember(true);
  }, [open, slicerId, printers]);

  const picked = printers.find((p) => p.printer.id === chosen && usable(p)) ?? null;

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth aria-labelledby="printer-ask-title">
      <DialogTitle id="printer-ask-title" sx={{ pb: 0.5 }}>
        {t("models:detail.askPrinter.title")}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("models:detail.askPrinter.subtitle", { slicer: slicerLabel })}
        </Typography>
        <Box
          role="radiogroup"
          aria-label={t("models:detail.askPrinter.title")}
          sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.25 }}
        >
          {printers.map((p) => {
            const selected = p.printer.id === chosen;
            const disabled = !usable(p);
            const bed = p.printer.bed;
            return (
              <Box
                key={p.printer.id}
                component="label"
                sx={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 0.75,
                  p: 1.5,
                  borderRadius: "10px",
                  border: selected ? 2 : 1,
                  // The border grows by one when selected; the padding gives it back, so nothing moves.
                  m: selected ? 0 : "1px",
                  borderColor: selected ? "primary.main" : "divider",
                  bgcolor: (theme) => (selected ? alpha(theme.palette.primary.main, 0.07) : "transparent"),
                  cursor: disabled ? "default" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                  transition: "border-color 150ms, background-color 150ms",
                  "&:has(input:focus-visible)": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
                }}
              >
                <Box
                  component="input"
                  type="radio"
                  name="printer"
                  value={p.printer.id}
                  checked={selected}
                  disabled={disabled}
                  onChange={() => setChosen(p.printer.id)}
                  sx={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
                />
                <Box
                  sx={{
                    width: PICTURE,
                    height: PICTURE,
                    borderRadius: "8px",
                    bgcolor: "common.white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <PrinterPicture printer={p.printer} size={PICTURE} />
                </Box>
                <Typography variant="body2" fontWeight={600} sx={{ textAlign: "center", lineHeight: 1.25 }}>
                  {p.brandName} {p.printer.model}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
                  {disabled
                    ? t("models:detail.askPrinter.notIn", { slicer: slicerLabel })
                    : bed
                      ? t("models:detail.askPrinter.detail", { nozzle: p.nozzle, x: bed.x, y: bed.y })
                      : t("models:detail.askPrinter.nozzle", { nozzle: p.nozzle })}
                </Typography>
              </Box>
            );
          })}
        </Box>
        <FormControlLabel
          sx={{ mt: 1.5, mr: 0 }}
          control={<Checkbox size="small" checked={remember} onChange={(e) => setRemember(e.target.checked)} />}
          label={
            <Typography variant="body2">
              {t("models:detail.askPrinter.remember", { slicer: slicerLabel })}{" "}
              <Typography component="span" variant="body2" color="text.secondary">
                · {t("models:detail.askPrinter.changeLater")}
              </Typography>
            </Typography>
          }
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t("common:cancel")}</Button>
        <Button
          variant="contained"
          disableElevation
          disabled={!picked}
          onClick={() => picked && onOpen(picked, remember)}
        >
          {t("models:detail.askPrinter.open")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
