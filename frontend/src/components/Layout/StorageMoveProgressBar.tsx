import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import FileMoveAnimation from "../FileMoveAnimation";
import { useStorageMove } from "./StorageMoveContext";

const MINI_TILE = 40;

/** Shown while model files move to a new storage structure; how it went arrives as a notification. No stop
 *  button: half the files in each structure is what moving them is there to end. */
export default function StorageMoveProgressBar() {
  const { t } = useTranslation("app");
  const { move, running } = useStorageMove();
  if (!move || !running) return null;
  const { done, total } = move;

  return (
    <Box sx={{ bgcolor: "background.paper", borderTop: "1px solid", borderColor: "divider", px: 2, py: 0.75 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ maxWidth: 520, mx: "auto" }}>
        <Box
          sx={{
            flexShrink: 0,
            width: MINI_TILE,
            height: MINI_TILE,
            borderRadius: "11px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "#ffffff",
            boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)",
            overflow: "hidden",
          }}
        >
          <FileMoveAnimation size={MINI_TILE - 4} />
        </Box>
        <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" noWrap sx={{ display: "block" }}>
            {total > 0
              ? t("storageMoveProgress.label", { done, total, moved: move.moved })
              : t("storageMoveProgress.starting")}
          </Typography>
          <LinearProgress
            variant={total > 0 ? "determinate" : "indeterminate"}
            value={total > 0 ? Math.min(100, (done / total) * 100) : 0}
            sx={{ borderRadius: 1, height: 6 }}
          />
        </Stack>
      </Stack>
    </Box>
  );
}
