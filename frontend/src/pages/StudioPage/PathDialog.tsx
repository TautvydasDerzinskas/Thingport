import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import HelpTip from "../../components/HelpTip";
import { PATH_CHARACTERS, pathContours } from "../../studio/svgPath";

// A path for the sketch being drawn: SVG path data, in the sketch's own millimetres, with what it draws beside it as
// it's typed. Copied from a drawing program or written by hand; the AI writes them the same way.

const EXAMPLE = "M -20 -10 H 20 V 10 A 10 10 0 0 1 10 20 H -20 Z";

type Props = {
  onClose: () => void;
  onAdd: (d: string) => void;
};

export default function PathDialog({ onClose, onAdd }: Props) {
  const { t } = useTranslation("app");
  const theme = useTheme();
  const [d, setD] = useState(EXAMPLE);
  const drawn = useMemo(() => {
    try {
      const loops = pathContours(d);
      const points = loops.flat();
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      // On screen y runs down; on a sketch v runs up.
      const outline = loops.map((loop) => `M${loop.map(([x, y]) => `${x} ${-y}`).join("L")}Z`).join("");
      const pad = Math.max(maxX - minX, maxY - minY) * 0.06 || 1;
      return {
        outline,
        box: `${minX - pad} ${-maxY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`,
        size: `${Number((maxX - minX).toFixed(2))} × ${Number((maxY - minY).toFixed(2))} mm`,
        error: null,
      };
    } catch (error) {
      return { outline: null, box: null, size: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [d]);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {t("studio.path.title")}
        <HelpTip text={t("studio.path.help")} />
      </DialogTitle>
      <DialogContent>
        <TextField
          label={t("studio.path.data")}
          value={d}
          onChange={(event) => setD(event.target.value)}
          multiline
          minRows={3}
          maxRows={8}
          fullWidth
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: { maxLength: PATH_CHARACTERS, spellCheck: false, style: { fontFamily: "monospace" } },
          }}
          sx={{ mt: 1 }}
        />
        <Box
          sx={{
            mt: 2,
            height: 220,
            borderRadius: 2,
            border: 1,
            borderColor: "divider",
            bgcolor: "background.default",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 1,
          }}
        >
          {drawn.outline ? (
            <Box
              component="svg"
              aria-hidden
              viewBox={drawn.box!}
              preserveAspectRatio="xMidYMid meet"
              sx={{ width: "100%", height: "100%" }}
            >
              <path d={drawn.outline} fillRule="evenodd" fill={alpha(theme.palette.primary.main, 0.85)} />
            </Box>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {t("studio.path.nothing")}
            </Typography>
          )}
        </Box>
        {drawn.size && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
            {drawn.size}
          </Typography>
        )}
        {drawn.error && (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            {drawn.error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t("studio.ops.cancel")}</Button>
        <Button
          variant="contained"
          disableElevation
          disabled={!drawn.outline}
          onClick={() => {
            onAdd(d.trim());
            onClose();
          }}
        >
          {t("studio.path.add")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
