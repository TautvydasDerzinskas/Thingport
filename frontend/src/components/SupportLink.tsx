import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import { alpha, useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CardActionArea from "@mui/material/CardActionArea";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import FavoriteIcon from "@mui/icons-material/Favorite";
import CoffeeIcon from "@mui/icons-material/LocalCafeOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { SUPPORT_WAYS } from "../constants/website";

// One beat of the heart, for the dialog opening and the chip being hovered.
const beat = keyframes`
  0% { transform: scale(1); }
  45% { transform: scale(1.28); }
  100% { transform: scale(1); }
`;
const stillWhenReduced = { "@media (prefers-reduced-motion: reduce)": { animation: "none" } };
/** Read by screen readers, not shown. */
const visuallyHiddenSx = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

/** "Love Thingport?", a chip in the heart's red that opens the ways to support Thingport. `long` adds "Show your
 *  support", where there's room for it. */
export default function SupportLink({ long = false }: { long?: boolean }) {
  const { t } = useTranslation(["app"]);
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const { heart } = theme.thingport.support;
  return (
    <>
      <Button
        size="small"
        startIcon={<FavoriteIcon />}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        sx={{
          borderRadius: 999,
          px: 1.25,
          py: 0.25,
          color: heart,
          bgcolor: alpha(heart, theme.palette.mode === "dark" ? 0.16 : 0.09),
          "&:hover": { bgcolor: alpha(heart, 0.2) },
          "&:hover .MuiButton-startIcon svg": { animation: `${beat} 300ms ease-out`, ...stillWhenReduced },
        }}
      >
        {t(long ? "support.linkLong" : "support.link")}
      </Button>
      <SupportDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** The ways to support Thingport, each opening its site in a tab of its own, with a line on what it is. */
export function SupportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(["app", "common"]);
  const theme = useTheme();
  const titleId = useId();
  const textId = useId();
  const { heart, coffee, onCoffee, sponsors } = theme.thingport.support;
  const looks: Record<(typeof SUPPORT_WAYS)[number]["id"], { icon: ReactNode; color: string; onColor: string }> = {
    coffee: { icon: <CoffeeIcon />, color: coffee, onColor: onCoffee },
    sponsors: { icon: <FavoriteIcon />, color: sponsors, onColor: theme.palette.common.white },
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby={titleId} aria-describedby={textId}>
      <DialogTitle id={titleId} sx={{ display: "flex", alignItems: "center", gap: 1, pr: 7 }}>
        <FavoriteIcon
          aria-hidden
          sx={{ color: heart, animation: `${beat} 300ms ease-out 200ms both`, ...stillWhenReduced }}
        />
        {t("support.title")}
      </DialogTitle>
      <Tooltip title={t("common:close")}>
        <IconButton aria-label={t("common:close")} onClick={onClose} sx={{ position: "absolute", top: 10, right: 10 }}>
          <CloseIcon />
        </IconButton>
      </Tooltip>
      <DialogContent>
        <Typography id={textId} variant="body2" color="text.secondary">
          {t("support.text")}
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 2 }}>
          {SUPPORT_WAYS.map((way) => {
            const look = looks[way.id];
            return (
              <Paper
                key={way.id}
                variant="outlined"
                sx={{
                  flex: 1,
                  overflow: "hidden",
                  transition: theme.transitions.create("border-color", { duration: 150 }),
                  "&:hover": { borderColor: "primary.main" },
                }}
              >
                <CardActionArea
                  component="a"
                  href={way.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ height: "100%", p: 2, display: "grid", gap: 1, alignContent: "start" }}
                >
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: 1.5,
                        display: "grid",
                        placeItems: "center",
                        bgcolor: look.color,
                        color: look.onColor,
                      }}
                    >
                      {look.icon}
                    </Box>
                    <OpenInNewIcon aria-hidden sx={{ fontSize: 16, color: "text.secondary" }} />
                  </Stack>
                  <Typography sx={{ fontWeight: 700 }}>{way.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t(way.id === "coffee" ? "support.coffee" : "support.sponsors")}
                  </Typography>
                  <Box component="span" sx={visuallyHiddenSx}>
                    {t("support.newTab")}
                  </Box>
                </CardActionArea>
              </Paper>
            );
          })}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t("support.later")}</Button>
      </DialogActions>
    </Dialog>
  );
}
