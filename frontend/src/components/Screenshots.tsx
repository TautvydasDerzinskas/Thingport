import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { alpha, keyframes } from "@mui/material/styles";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
/** A picture of a widget or a tool at work, as its metadata names it. */
export type Screenshot = { file: string; caption?: string };

const THUMB = { width: 112, height: 70 };
// The strip shows this many; the last one says how many more the viewer has.
const SHOWN = 3;

const fadeIn = keyframes`from { opacity: 0; transform: scale(0.985); } to { opacity: 1; transform: none; }`;

type Props = {
  /** What it's of, for the labels a screen reader gets. */
  name: string;
  screenshots: Screenshot[];
  /** Where each one is served from: the admin routes for a repository tool, the widget routes for a shared widget. */
  urlFor: (index: number) => string;
};

/** A few screenshots in a row, and all of them, large, in a viewer: what something looks like before it's
 *  installed. */
export default function Screenshots({ name, screenshots, urlFor }: Props) {
  const { t } = useTranslation("app");
  const [open, setOpen] = useState<number | null>(null);
  if (!screenshots.length) return null;
  const more = screenshots.length - SHOWN;

  return (
    <>
      <Stack direction="row" spacing={1} sx={{ mt: 1.25, overflowX: "auto", pb: 0.25 }}>
        {screenshots.slice(0, SHOWN).map((shot, index) => {
          const overflow = index === SHOWN - 1 && more > 0;
          return (
            <ButtonBase
              key={shot.file}
              onClick={() => setOpen(index)}
              aria-label={t("screenshots.open", { name, index: index + 1, count: screenshots.length })}
              sx={{
                position: "relative",
                flexShrink: 0,
                width: THUMB.width,
                height: THUMB.height,
                borderRadius: "8px",
                overflow: "hidden",
                border: 1,
                borderColor: "divider",
                bgcolor: "action.hover",
                transition: "transform 150ms, border-color 150ms",
                "&:hover": { transform: "translateY(-2px)", borderColor: "primary.main" },
                "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
                "@media (prefers-reduced-motion: reduce)": { transition: "none", "&:hover": { transform: "none" } },
              }}
            >
              <Box
                component="img"
                src={urlFor(index)}
                alt=""
                loading="lazy"
                sx={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
              />
              {overflow && (
                <Box
                  aria-hidden
                  sx={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: (theme) => alpha(theme.palette.common.black, 0.55),
                    color: "common.white",
                    fontWeight: 700,
                  }}
                >
                  +{more + 1}
                </Box>
              )}
            </ButtonBase>
          );
        })}
      </Stack>
      <ScreenshotViewer
        name={name}
        urlFor={urlFor}
        screenshots={screenshots}
        index={open}
        onIndex={setOpen}
        onClose={() => setOpen(null)}
      />
    </>
  );
}

function ScreenshotViewer({
  name,
  urlFor,
  screenshots,
  index,
  onIndex,
  onClose,
}: Props & { index: number | null; onIndex: (index: number) => void; onClose: () => void }) {
  const { t } = useTranslation("app");
  const count = screenshots.length;
  const go = (step: number) => index !== null && onIndex((index + step + count) % count);

  useEffect(() => {
    if (index === null || count < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") onIndex((index + 1) % count);
      if (event.key === "ArrowLeft") onIndex((index - 1 + count) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count, onIndex]);

  const shot = index === null ? null : screenshots[index];

  return (
    <Dialog
      open={index !== null}
      onClose={onClose}
      maxWidth={false}
      aria-label={t("screenshots.title", { name })}
      slotProps={{
        paper: {
          sx: { width: 1200, maxWidth: "calc(100% - 32px)", m: 2, overflow: "hidden", bgcolor: "background.paper" },
        },
      }}
    >
      {shot && index !== null && (
        <>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ pl: 2, pr: 1, py: 0.75 }}>
            <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1, minWidth: 0 }}>
              {name}
              <Box component="span" sx={{ color: "text.secondary", fontWeight: 400 }}>
                {` · ${t("screenshots.position", { index: index + 1, count })}`}
              </Box>
            </Typography>
            <Tooltip title={t("screenshots.close")}>
              <IconButton size="small" aria-label={t("screenshots.close")} onClick={onClose}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          <Box
            sx={{
              position: "relative",
              bgcolor: (theme) => theme.thingport.pageBackground,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 240,
            }}
          >
            <Box
              key={index}
              component="img"
              src={urlFor(index)}
              alt={shot.caption ?? ""}
              sx={{
                display: "block",
                maxWidth: "100%",
                maxHeight: "calc(100vh - 200px)",
                objectFit: "contain",
                animation: `${fadeIn} 200ms ease-out`,
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
              }}
            />
            {count > 1 &&
              (
                [
                  [-1, "previous", <ChevronLeftIcon key="l" />, { left: 8 }],
                  [1, "next", <ChevronRightIcon key="r" />, { right: 8 }],
                ] as const
              ).map(([step, label, icon, place]) => (
                <Tooltip key={label} title={t(`screenshots.${label}`)}>
                  <IconButton
                    aria-label={t(`screenshots.${label}`)}
                    onClick={() => go(step)}
                    sx={{
                      position: "absolute",
                      top: "50%",
                      transform: "translateY(-50%)",
                      ...place,
                      bgcolor: (theme) => alpha(theme.palette.background.paper, 0.85),
                      boxShadow: 2,
                      "&:hover": { bgcolor: "background.paper" },
                    }}
                  >
                    {icon}
                  </IconButton>
                </Tooltip>
              ))}
          </Box>
          {shot.caption && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.25 }}>
              {shot.caption}
            </Typography>
          )}
        </>
      )}
    </Dialog>
  );
}
