import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Collapse from "@mui/material/Collapse";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import MonitorWeightOutlinedIcon from "@mui/icons-material/MonitorWeightOutlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import VerifiedOutlinedIcon from "@mui/icons-material/VerifiedOutlined";
import { plateName, printerLine, settingsLine, type ProfileEntry } from "./entries";
import { useProfileFormat } from "./format";
import { Fact, FilamentDots, FilamentList, GroupLabel, LineSkeleton, ProfileCover, ProfilePlateThumb } from "./parts";
import { OtherFileIcon, useOtherFileText } from "./otherFiles";
import type { ProfileViewProps } from "./types";

const VISIBLE = 4;

const rowButtonSx = {
  width: 1,
  gap: 1.25,
  px: 1,
  py: 0.75,
  justifyContent: "flex-start",
  textAlign: "left",
  borderRadius: 2,
  "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: -2 },
} as const;

function Row({
  entry,
  selected,
  onSelect,
  onPreviewPlate,
}: {
  entry: ProfileEntry;
  selected: boolean;
  onSelect: () => void;
  onPreviewPlate?: (plateIndex: number) => void;
}) {
  const { t } = useTranslation("models");
  const format = useProfileFormat();
  const { profile } = entry;
  const time = format.duration(profile?.seconds);
  const grams = format.grams(profile?.grams);
  const plates = profile?.plates ?? [];
  const printer = printerLine(t, format, profile);
  const settings = settingsLine(t, format, profile);
  return (
    <Box
      sx={{
        position: "relative",
        borderRadius: 2,
        bgcolor: selected ? "action.selected" : "transparent",
        transition: "background-color 150ms",
        "&::before": {
          content: '""',
          position: "absolute",
          left: 0,
          top: 8,
          bottom: 8,
          width: 3,
          borderRadius: 2,
          bgcolor: "primary.main",
          opacity: selected ? 1 : 0,
          transition: "opacity 150ms",
        },
        "@media (prefers-reduced-motion: reduce)": { transition: "none", "&::before": { transition: "none" } },
      }}
    >
      <ButtonBase
        onClick={onSelect}
        aria-pressed={selected}
        sx={{ ...rowButtonSx, "&:hover": { bgcolor: selected ? undefined : "action.hover" } }}
      >
        <ProfileCover plate={entry.plate} size={40} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" fontWeight={600} noWrap title={entry.title}>
            {entry.title}
          </Typography>
          {entry.loading ? (
            <LineSkeleton width="70%" />
          ) : (
            <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
              {time && (
                <Fact icon={<ScheduleOutlinedIcon />} label={t("detail.profiles.time")}>
                  {time}
                </Fact>
              )}
              {grams && (
                <Fact icon={<MonitorWeightOutlinedIcon />} label={t("detail.profiles.filament")}>
                  {grams}
                </Fact>
              )}
              {plates.length > 1 && (
                <Fact icon={<LayersOutlinedIcon />} label={t("detail.profiles.plates", { count: plates.length })}>
                  {plates.length}
                </Fact>
              )}
              <FilamentDots filaments={profile?.filaments ?? []} max={5} size={11} />
              {profile?.origin === "community" && profile.creator && (
                <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
                  · {profile.creator}
                </Typography>
              )}
            </Stack>
          )}
        </Box>
      </ButtonBase>
      <Collapse in={selected} timeout={200} unmountOnExit>
        <Stack spacing={0.75} sx={{ pl: "60px", pr: 1, pb: 1.25 }}>
          {entry.loading ? (
            <>
              <LineSkeleton width="80%" />
              <LineSkeleton width="60%" />
            </>
          ) : (
            <>
              {printer && <Fact icon={<PrintOutlinedIcon />}>{printer}</Fact>}
              {settings && <Fact icon={<TuneOutlinedIcon />}>{settings}</Fact>}
              {profile?.description && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  title={profile.description}
                  sx={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                >
                  {profile.description}
                </Typography>
              )}
              {(profile?.filaments.length ?? 0) > 1 && <FilamentList filaments={profile!.filaments} />}
            </>
          )}
          {plates.length > 1 && (
            <Stack direction="row" spacing={0.75} sx={{ pt: 0.25, flexWrap: "wrap", rowGap: 0.75 }}>
              {plates.map((plate) => (
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
                    onClick={() => onPreviewPlate?.(plate.index)}
                    aria-label={t("detail.profiles.previewPlate", { plate: plateName(t, plate.index, plate.name) })}
                    sx={{ borderRadius: 1.25 }}
                  >
                    <ProfilePlateThumb src={plate.thumb_url} size={44} />
                  </ButtonBase>
                </Tooltip>
              ))}
            </Stack>
          )}
        </Stack>
      </Collapse>
    </Box>
  );
}

/** Every profile listed, the designer's first, so their times and filament compare at a glance; the picked one opens
 *  up with its printer, settings, filaments and plates. */
export default function ProfileList({ entries, otherFiles, selectedKey, onSelect, onPreviewPlate }: ProfileViewProps) {
  const { t } = useTranslation("models");
  const otherText = useOtherFileText();
  const [showAll, setShowAll] = useState(false);
  const designer = entries.filter((e) => e.profile?.origin === "designer");
  const community = entries.filter((e) => e.profile?.origin === "community");
  const unknown = entries.filter((e) => !e.profile?.origin);
  // The picked one stays in sight however many are folded away.
  const visible = new Set(
    (showAll ? entries : entries.slice(0, VISIBLE)).map((e) => e.key).concat(selectedKey ? [selectedKey] : []),
  );
  const hidden = entries.filter((e) => !visible.has(e.key)).length;
  const row = (entry: ProfileEntry) =>
    visible.has(entry.key) && (
      <Row
        key={entry.key}
        entry={entry}
        selected={entry.key === selectedKey}
        onSelect={() => onSelect(entry.key)}
        onPreviewPlate={onPreviewPlate ? (index) => onPreviewPlate(entry.key, index) : undefined}
      />
    );

  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 0.5 }}>
      {designer.length > 0 && (
        <GroupLabel icon={<VerifiedOutlinedIcon />}>{t("detail.profiles.fromDesigner")}</GroupLabel>
      )}
      {designer.map(row)}
      {community.some((e) => visible.has(e.key)) && (
        <GroupLabel icon={<GroupsOutlinedIcon />}>{t("detail.profiles.communityGroup")}</GroupLabel>
      )}
      {community.map(row)}
      {unknown.map(row)}
      {(hidden > 0 || showAll) && entries.length > VISIBLE && (
        <ButtonBase
          onClick={() => setShowAll((value) => !value)}
          aria-expanded={showAll}
          sx={{ width: 1, py: 0.75, gap: 0.5, borderRadius: 2, color: "text.secondary", fontSize: "0.75rem" }}
        >
          {showAll ? t("detail.profiles.showFewer") : t("detail.profiles.showMore", { count: hidden })}
          <ExpandMoreIcon
            sx={{
              fontSize: 16,
              transition: "transform 150ms",
              transform: showAll ? "rotate(180deg)" : "none",
              "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            }}
          />
        </ButtonBase>
      )}
      {otherFiles.length > 0 && (
        <>
          <GroupLabel icon={<InsertDriveFileOutlinedIcon />}>{t("detail.profiles.otherFiles")}</GroupLabel>
          {otherFiles.map((file) => {
            const text = otherText(file);
            const selected = file.key === selectedKey;
            return (
              <ButtonBase
                key={file.key}
                onClick={() => onSelect(file.key)}
                aria-pressed={selected}
                title={file.filename}
                sx={{
                  ...rowButtonSx,
                  bgcolor: selected ? "action.selected" : "transparent",
                  "&:hover": { bgcolor: selected ? undefined : "action.hover" },
                }}
              >
                <OtherFileIcon file={file} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {text.primary}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                    {text.secondary}
                  </Typography>
                </Box>
              </ButtonBase>
            );
          })}
        </>
      )}
    </Box>
  );
}
