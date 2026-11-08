import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import LayersIcon from "@mui/icons-material/Layers";
import MonitorWeightOutlinedIcon from "@mui/icons-material/MonitorWeightOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import type { ProfileFilament } from "../../../api/prints";
import { plateName, type ProfileEntry } from "./entries";
import { useProfileFormat } from "./format";
import { Fact, FilamentDots, OriginChip, ProfileCover, ProfilePlateThumb } from "./parts";
import { OtherFileIcon, useOtherFileText } from "./otherFiles";
import { profileMenuRows } from "./ProfilePicker";
import type { ModelFile } from "../useOpenInSlicer";

/** One build plate of the open file, with what the profile and the viewer know of it. */
export type PreviewPlateRow = {
  index: number;
  name: string | null;
  seconds: number | null;
  grams: number | null;
  filaments: ProfileFilament[];
  objects: number | null;
  /** A stored picture's URL, or one the viewer read out of the file. */
  thumb: string | null;
};

type Props = {
  /** "outline" lists every profile with the open one's plates under it; "picker" picks one above its plates. */
  variant: "outline" | "picker";
  entries: ProfileEntry[];
  otherFiles: ModelFile[];
  activeKey: string | null;
  onSelectFile: (key: string) => void;
  plates: PreviewPlateRow[];
  selectedPlate: number | null;
  onSelectPlate: (index: number) => void;
};

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{
        display: "block",
        px: 1,
        py: 0.5,
        fontSize: "0.7rem",
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
      }}
    >
      {children}
    </Typography>
  );
}

function PlateRows({
  plates,
  selected,
  onSelect,
}: {
  plates: PreviewPlateRow[];
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation("models");
  const format = useProfileFormat();
  return (
    <List disablePadding>
      {plates.map((plate) => {
        const time = format.duration(plate.seconds);
        const grams = format.grams(plate.grams);
        return (
          <ListItemButton
            key={plate.index}
            selected={plate.index === selected}
            onClick={() => onSelect(plate.index)}
            sx={{ borderRadius: 1, mb: 0.5, py: 0.5, px: 1 }}
          >
            <ListItemIcon sx={{ minWidth: 48 }}>
              {plate.thumb ? (
                <ProfilePlateThumb src={plate.thumb} size={40} />
              ) : (
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 1.25,
                    bgcolor: "action.hover",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <LayersIcon fontSize="small" color="disabled" />
                </Box>
              )}
            </ListItemIcon>
            <ListItemText
              primary={plateName(t, plate.index, plate.name)}
              secondary={
                time || grams || plate.filaments.length ? (
                  <Stack component="span" direction="row" alignItems="center" spacing={1}>
                    {time && <Fact icon={<ScheduleOutlinedIcon />}>{time}</Fact>}
                    {grams && <Fact icon={<MonitorWeightOutlinedIcon />}>{grams}</Fact>}
                    <FilamentDots filaments={plate.filaments} max={4} size={10} />
                  </Stack>
                ) : plate.objects != null ? (
                  t("detail.internalPlateObjectCount", { count: plate.objects })
                ) : null
              }
              primaryTypographyProps={{ variant: "body2", noWrap: true }}
              secondaryTypographyProps={{ component: "span", variant: "caption" }}
            />
          </ListItemButton>
        );
      })}
    </List>
  );
}

/** The 3D preview's list for a model with print profiles: the profiles, and the open one's build plates rather than
 *  each profile as a file. */
export default function PreviewProfilePanel({
  variant,
  entries,
  otherFiles,
  activeKey,
  onSelectFile,
  plates,
  selectedPlate,
  onSelectPlate,
}: Props) {
  const { t } = useTranslation("models");
  const format = useProfileFormat();
  const otherText = useOtherFileText();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const active = entries.find((e) => e.key === activeKey) ?? null;
  const activeOther = active ? null : (otherFiles.find((f) => f.key === activeKey) ?? null);

  if (variant === "picker") {
    const label = activeOther ? otherText(activeOther).primary : (active?.title ?? "");
    return (
      <>
        <Caption>{t("detail.profiles.labelOne")}</Caption>
        <ButtonBase
          onClick={(event) => setAnchor(event.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchor)}
          aria-label={t("detail.profiles.pickAria", { name: label })}
          title={label}
          sx={{
            width: 1,
            gap: 1,
            px: 1,
            py: 0.75,
            justifyContent: "flex-start",
            textAlign: "left",
            border: "1px solid",
            borderColor: anchor ? "primary.main" : "divider",
            borderRadius: 2,
            "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: 1 },
          }}
        >
          {activeOther ? (
            <OtherFileIcon file={activeOther} size={36} />
          ) : (
            active && <ProfileCover plate={active.plate} size={36} />
          )}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" fontWeight={600} noWrap>
              {label}
            </Typography>
            {active && (
              <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
                <OriginChip origin={active.profile?.origin} />
                <Typography variant="caption" color="text.secondary" noWrap>
                  {[format.duration(active.profile?.seconds), format.grams(active.profile?.grams)]
                    .filter(Boolean)
                    .join(" · ")}
                </Typography>
              </Stack>
            )}
          </Box>
          <ArrowDropDownIcon sx={{ color: "text.secondary" }} />
        </ButtonBase>
        <Menu
          anchorEl={anchor}
          open={Boolean(anchor)}
          onClose={() => setAnchor(null)}
          slotProps={{ paper: { sx: { width: Math.max(anchor?.offsetWidth ?? 0, 300), maxHeight: 420 } } }}
        >
          {profileMenuRows({
            entries,
            otherFiles,
            selectedKey: activeKey,
            t,
            format,
            otherText,
            onPick: (key) => {
              onSelectFile(key);
              setAnchor(null);
            },
          })}
        </Menu>
        {plates.length > 0 && (
          <>
            <Divider sx={{ my: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {t("detail.profiles.platesInProfile", { count: plates.length })}
              </Typography>
            </Divider>
            <PlateRows plates={plates} selected={selectedPlate} onSelect={onSelectPlate} />
          </>
        )}
      </>
    );
  }

  return (
    <>
      <Caption>{t("detail.profiles.label", { count: entries.length })}</Caption>
      {entries.map((entry) => {
        const open = entry.key === activeKey;
        return (
          <Box key={entry.key} sx={{ mb: 0.5 }}>
            <ButtonBase
              onClick={() => onSelectFile(entry.key)}
              aria-expanded={open}
              title={entry.title}
              sx={{
                width: 1,
                gap: 1,
                px: 0.5,
                py: 0.75,
                justifyContent: "flex-start",
                textAlign: "left",
                borderRadius: 1.5,
                bgcolor: open ? "action.selected" : "transparent",
                "&:hover": { bgcolor: open ? undefined : "action.hover" },
                "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: -2 },
              }}
            >
              <ChevronRightIcon
                sx={{
                  fontSize: 18,
                  color: "text.secondary",
                  transition: "transform 150ms",
                  transform: open ? "rotate(90deg)" : "none",
                  "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                }}
              />
              <ProfileCover plate={entry.plate} size={30} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {entry.title}
                </Typography>
                <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
                  <OriginChip origin={entry.profile?.origin} compact />
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {[
                      format.duration(entry.profile?.seconds),
                      format.grams(entry.profile?.grams),
                      (entry.profile?.plates.length ?? 0) > 1
                        ? t("detail.profiles.plates", { count: entry.profile!.plates.length })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                </Stack>
              </Box>
            </ButtonBase>
            <Collapse in={open} timeout={200} unmountOnExit>
              <Box sx={{ pl: 2, pt: 0.5, ml: 1.25, borderLeft: "2px solid", borderColor: "divider" }}>
                <PlateRows plates={open ? plates : []} selected={selectedPlate} onSelect={onSelectPlate} />
              </Box>
            </Collapse>
          </Box>
        );
      })}
      {otherFiles.length > 0 && (
        <>
          <Caption>{t("detail.profiles.otherFiles")}</Caption>
          {otherFiles.map((file) => {
            const open = file.key === activeKey;
            return (
              <Box key={file.key} sx={{ mb: 0.5 }}>
                <ButtonBase
                  onClick={() => onSelectFile(file.key)}
                  title={file.filename}
                  sx={{
                    width: 1,
                    gap: 1,
                    px: 0.5,
                    py: 0.75,
                    justifyContent: "flex-start",
                    textAlign: "left",
                    borderRadius: 1.5,
                    bgcolor: open ? "action.selected" : "transparent",
                    "&:hover": { bgcolor: open ? undefined : "action.hover" },
                  }}
                >
                  <Box sx={{ width: 18 }} />
                  <OtherFileIcon file={file} size={30} />
                  <Typography variant="body2" fontWeight={600} noWrap sx={{ minWidth: 0 }}>
                    {otherText(file).primary}
                  </Typography>
                </ButtonBase>
                <Collapse in={open && plates.length > 1} timeout={200} unmountOnExit>
                  <Box sx={{ pl: 2, pt: 0.5, ml: 1.25, borderLeft: "2px solid", borderColor: "divider" }}>
                    <PlateRows plates={open ? plates : []} selected={selectedPlate} onSelect={onSelectPlate} />
                  </Box>
                </Collapse>
              </Box>
            );
          })}
        </>
      )}
    </>
  );
}
