import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import MonitorWeightOutlinedIcon from "@mui/icons-material/MonitorWeightOutlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import { plateName, printerLine, settingsLine } from "./entries";
import { useProfileFormat } from "./format";
import { Fact, FilamentDots, LineSkeleton, OriginChip, ProfileCover, ProfilePlateThumb } from "./parts";
import { OtherFileIcon, useOtherFileText } from "./otherFiles";
import type { ProfileViewProps } from "./types";

const TILE_WIDTH = 118;
const PICTURE_HEIGHT = 80;

const tileSx = (selected: boolean) =>
  ({
    width: TILE_WIDTH,
    flexShrink: 0,
    scrollSnapAlign: "start",
    flexDirection: "column",
    alignItems: "stretch",
    textAlign: "left",
    borderRadius: 2,
    border: "2px solid",
    borderColor: selected ? "primary.main" : "transparent",
    bgcolor: selected ? "action.selected" : "transparent",
    p: 0.5,
    transition: "border-color 150ms, background-color 150ms",
    "&:hover": { bgcolor: selected ? undefined : "action.hover" },
    "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: 1 },
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
  }) as const;

/** Profiles as a row of their pictures that scrolls sideways, a Designer or Community badge on each; the picked one's
 *  facts in a strip below. */
export default function ProfileTiles({ entries, otherFiles, selectedKey, onSelect, onPreviewPlate }: ProfileViewProps) {
  const { t } = useTranslation("models");
  const format = useProfileFormat();
  const otherText = useOtherFileText();
  const entry = entries.find((e) => e.key === selectedKey) ?? null;
  const otherFile = entry ? null : (otherFiles.find((f) => f.key === selectedKey) ?? null);
  const profile = entry?.profile ?? null;
  const printer = printerLine(t, format, profile);
  const settings = settingsLine(t, format, profile);
  const plates = profile?.plates.length ?? 0;

  return (
    <Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          pb: 0.75,
          pt: 0.25,
          mx: -0.25,
          px: 0.25,
          "&::-webkit-scrollbar": { height: 6 },
          "&::-webkit-scrollbar-thumb": { bgcolor: "divider", borderRadius: 3 },
        }}
      >
        {entries.map((e) => {
          const selected = e.key === selectedKey;
          return (
            <ButtonBase
              key={e.key}
              onClick={() => onSelect(e.key)}
              aria-pressed={selected}
              title={e.title}
              sx={tileSx(selected)}
            >
              <Box sx={{ position: "relative" }}>
                <ProfileCover plate={e.plate} width={TILE_WIDTH - 12} height={PICTURE_HEIGHT} />
                <Box sx={{ position: "absolute", top: 4, left: 4 }}>
                  <OriginChip origin={e.profile?.origin} overlay />
                </Box>
              </Box>
              <Typography
                variant="caption"
                fontWeight={600}
                sx={{
                  mt: 0.5,
                  lineHeight: 1.3,
                  color: "text.primary",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  minHeight: "2.6em",
                }}
              >
                {e.title}
              </Typography>
              {e.loading ? (
                <LineSkeleton width="80%" />
              ) : (
                <Typography variant="caption" color="text.secondary" noWrap sx={{ fontSize: "0.7rem" }}>
                  {[format.duration(e.profile?.seconds), format.grams(e.profile?.grams)].filter(Boolean).join(" · ") ||
                    " "}
                </Typography>
              )}
            </ButtonBase>
          );
        })}
        {otherFiles.map((file) => {
          const selected = file.key === selectedKey;
          const text = otherText(file);
          return (
            <ButtonBase
              key={file.key}
              onClick={() => onSelect(file.key)}
              aria-pressed={selected}
              title={file.filename}
              sx={tileSx(selected)}
            >
              <Box
                sx={{
                  height: PICTURE_HEIGHT,
                  borderRadius: 1.5,
                  border: "1px dashed",
                  borderColor: "divider",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <OtherFileIcon file={file} size={48} />
              </Box>
              <Typography variant="caption" fontWeight={600} noWrap sx={{ mt: 0.5, color: "text.primary" }}>
                {text.primary}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ fontSize: "0.7rem" }}>
                {t("detail.profiles.otherFile")}
              </Typography>
            </ButtonBase>
          );
        })}
      </Stack>

      <Box sx={{ mt: 0.75, p: 1.25, borderRadius: 2, bgcolor: "action.hover" }}>
        {otherFile ? (
          <>
            <Typography variant="body2" fontWeight={600} noWrap title={otherFile.filename}>
              {otherText(otherFile).primary}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {otherText(otherFile).secondary}
            </Typography>
          </>
        ) : entry ? (
          <>
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75, minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600} noWrap sx={{ minWidth: 0, flex: 1 }} title={entry.title}>
                {entry.title}
              </Typography>
              {profile?.origin === "community" && profile.creator && (
                <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>
                  {t("detail.profiles.byCreator", { name: profile.creator })}
                </Typography>
              )}
            </Stack>
            {entry.loading ? (
              <>
                <LineSkeleton width="70%" />
                <LineSkeleton width="55%" />
              </>
            ) : (
              <Stack spacing={0.5}>
                <Stack direction="row" alignItems="center" spacing={1.25} flexWrap="wrap" useFlexGap>
                  {format.duration(profile?.seconds) && (
                    <Fact icon={<ScheduleOutlinedIcon />} label={t("detail.profiles.time")}>
                      {format.duration(profile?.seconds)}
                    </Fact>
                  )}
                  {format.grams(profile?.grams) && (
                    <Fact icon={<MonitorWeightOutlinedIcon />} label={t("detail.profiles.filament")}>
                      {format.grams(profile?.grams)}
                    </Fact>
                  )}
                  {plates > 0 && (
                    <Fact icon={<LayersOutlinedIcon />}>{t("detail.profiles.plates", { count: plates })}</Fact>
                  )}
                  <FilamentDots filaments={profile?.filaments ?? []} max={8} />
                </Stack>
                {printer && <Fact icon={<PrintOutlinedIcon />}>{printer}</Fact>}
                {settings && <Fact icon={<TuneOutlinedIcon />}>{settings}</Fact>}
              </Stack>
            )}
            {plates > 1 && (
              <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: "wrap", rowGap: 0.75 }}>
                {profile!.plates.map((plate) => (
                  <Tooltip
                    key={plate.index}
                    title={[
                      plateName(t, plate.index, plate.name),
                      format.duration(plate.seconds),
                      format.grams(plate.grams),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    <ButtonBase
                      onClick={() => onPreviewPlate?.(entry.key, plate.index)}
                      aria-label={t("detail.profiles.previewPlate", { plate: plateName(t, plate.index, plate.name) })}
                      sx={{ borderRadius: 1.25 }}
                    >
                      <ProfilePlateThumb src={plate.thumb_url} size={40} index={plate.index} />
                    </ButtonBase>
                  </Tooltip>
                ))}
              </Stack>
            )}
          </>
        ) : null}
      </Box>
    </Box>
  );
}
