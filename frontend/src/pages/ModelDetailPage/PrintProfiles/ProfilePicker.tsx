import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Divider from "@mui/material/Divider";
import ListSubheader from "@mui/material/ListSubheader";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import MonitorWeightOutlinedIcon from "@mui/icons-material/MonitorWeightOutlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import { plateName, printerLine, settingsLine, shortPrinter, type ProfileEntry } from "./entries";
import { Fact, FilamentList, LineSkeleton, OriginChip, ProfileCover, ProfilePlateThumb } from "./parts";
import { OtherFileIcon, useOtherFileText } from "./otherFiles";
import { useProfileFormat, type ProfileFormat } from "./format";
import type { ProfileViewProps } from "./types";

const tileSx = {
  flex: 1,
  minWidth: 0,
  px: 0.75,
  py: 0.75,
  border: "1px solid",
  borderColor: "divider",
  borderRadius: 2,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 0.75,
  color: "text.secondary",
  "& svg": { fontSize: 17 },
} as const;

function StatTile({
  icon,
  value,
  label,
  loading,
}: {
  icon: React.ReactNode;
  value: string | null;
  label: string;
  loading?: boolean;
}) {
  return (
    <Box sx={tileSx} title={label}>
      {icon}
      {loading ? (
        <Skeleton variant="text" width={36} sx={{ fontSize: "0.875rem" }} />
      ) : (
        <Typography variant="body2" fontWeight={600} noWrap sx={{ color: "text.primary" }}>
          {value ?? "—"}
        </Typography>
      )}
    </Box>
  );
}

type MenuRowsOptions = Pick<ProfileViewProps, "entries" | "otherFiles" | "selectedKey"> & {
  onPick: (key: string) => void;
  t: TFunction;
  format: ProfileFormat;
  otherText: ReturnType<typeof useOtherFileText>;
};

/** The menu's rows, as the menu's own children so its keyboard moves between them: the designer's profiles first,
 *  then the community's, then any plain files. */
export function profileMenuRows({ entries, otherFiles, selectedKey, onPick, t, format, otherText }: MenuRowsOptions) {
  const designer = entries.filter((e) => e.profile?.origin === "designer");
  const community = entries.filter((e) => e.profile?.origin === "community");
  const unknown = entries.filter((e) => !e.profile?.origin);
  const subheaderSx = { lineHeight: "30px", bgcolor: "inherit" };
  const item = (entry: ProfileEntry) => {
    const { profile } = entry;
    const printer = shortPrinter(profile?.printer);
    return (
      <MenuItem
        key={entry.key}
        selected={entry.key === selectedKey}
        onClick={() => onPick(entry.key)}
        title={entry.title}
        sx={{ gap: 1.25, py: 0.75 }}
      >
        <ProfileCover plate={entry.plate} size={36} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" fontWeight={600} noWrap>
            {entry.title}
          </Typography>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
            {format.duration(profile?.seconds) && (
              <Fact icon={<ScheduleOutlinedIcon />}>{format.duration(profile?.seconds)}</Fact>
            )}
            {format.grams(profile?.grams) && (
              <Fact icon={<MonitorWeightOutlinedIcon />}>{format.grams(profile?.grams)}</Fact>
            )}
            {printer && <Fact icon={<PrintOutlinedIcon />}>{printer}</Fact>}
            {profile?.origin === "community" && profile.creator && (
              <Typography variant="caption" color="text.secondary" noWrap>
                · {profile.creator}
              </Typography>
            )}
          </Stack>
        </Box>
      </MenuItem>
    );
  };
  return [
    designer.length > 0 && (
      <ListSubheader key="designer" sx={subheaderSx}>
        {t("detail.profiles.fromDesigner")}
      </ListSubheader>
    ),
    ...designer.map(item),
    community.length > 0 && (
      <ListSubheader key="community" sx={subheaderSx}>
        {t("detail.profiles.communityGroup")}
      </ListSubheader>
    ),
    ...community.map(item),
    unknown.length > 0 && (designer.length > 0 || community.length > 0) && <Divider key="unknown-divider" />,
    ...unknown.map(item),
    otherFiles.length > 0 && <Divider key="files-divider" />,
    otherFiles.length > 0 && (
      <ListSubheader key="files" sx={subheaderSx}>
        {t("detail.profiles.otherFiles")}
      </ListSubheader>
    ),
    ...otherFiles.map((file) => {
      const text = otherText(file);
      return (
        <MenuItem
          key={file.key}
          selected={file.key === selectedKey}
          onClick={() => onPick(file.key)}
          title={file.filename}
          sx={{ gap: 1.25, py: 0.75 }}
        >
          <OtherFileIcon file={file} size={36} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} noWrap>
              {text.primary}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
              {text.secondary}
            </Typography>
          </Box>
        </MenuItem>
      );
    }),
  ].filter(Boolean);
}

/** One row for the picked profile, as the file picker was, with its maker's tag; its numbers, filaments, printer,
 *  settings and plates below. */
export default function ProfilePicker({
  entries,
  otherFiles,
  selectedKey,
  onSelect,
  onPreviewPlate,
}: ProfileViewProps) {
  const { t } = useTranslation("models");
  const format = useProfileFormat();
  const otherText = useOtherFileText();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const entry = entries.find((e) => e.key === selectedKey) ?? null;
  const otherFile = entry ? null : (otherFiles.find((f) => f.key === selectedKey) ?? null);
  const shown = entry ?? entries[0];
  const profile = entry?.profile ?? null;
  const plates = profile?.plates ?? [];
  const printer = printerLine(t, format, profile);
  const settings = settingsLine(t, format, profile);
  const pickerLabel = otherFile ? otherText(otherFile).primary : shown.title;

  return (
    <Box>
      <ButtonBase
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        aria-label={t("detail.profiles.pickAria", { name: pickerLabel })}
        title={pickerLabel}
        sx={{
          width: 1,
          gap: 1.25,
          px: 1,
          py: 0.75,
          justifyContent: "flex-start",
          textAlign: "left",
          border: "1px solid",
          borderColor: anchor ? "primary.main" : "divider",
          borderRadius: 2,
          transition: "border-color 150ms",
          "&:hover": { borderColor: "text.secondary" },
          "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: 1 },
        }}
      >
        {otherFile ? <OtherFileIcon file={otherFile} /> : <ProfileCover plate={shown.plate} size={40} />}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" fontWeight={600} noWrap>
            {pickerLabel}
          </Typography>
          {otherFile ? (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
              {otherText(otherFile).secondary}
            </Typography>
          ) : (
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.25, minWidth: 0 }}>
              <OriginChip origin={profile?.origin} />
              {profile?.origin === "community" && profile.creator && (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {t("detail.profiles.byCreator", { name: profile.creator })}
                </Typography>
              )}
            </Stack>
          )}
        </Box>
        <ArrowDropDownIcon
          sx={{
            color: "text.secondary",
            transition: "transform 150ms",
            transform: anchor ? "rotate(180deg)" : "none",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
          }}
        />
      </ButtonBase>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { width: anchor?.offsetWidth, maxHeight: 440 } } }}
      >
        {profileMenuRows({
          entries,
          otherFiles,
          selectedKey,
          t,
          format,
          otherText,
          onPick: (key) => {
            onSelect(key);
            setAnchor(null);
          },
        })}
      </Menu>

      {entry && (
        <>
          <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
            <StatTile
              icon={<ScheduleOutlinedIcon />}
              label={t("detail.profiles.time")}
              value={format.duration(profile?.seconds)}
              loading={entry.loading}
            />
            <StatTile
              icon={<MonitorWeightOutlinedIcon />}
              label={t("detail.profiles.filament")}
              value={format.grams(profile?.grams)}
              loading={entry.loading}
            />
            <StatTile
              icon={<LayersOutlinedIcon />}
              label={t("detail.profiles.platesLabel")}
              value={plates.length ? t("detail.profiles.plates", { count: plates.length }) : null}
              loading={entry.loading}
            />
          </Stack>
          <Stack spacing={0.75} sx={{ mt: 1.25 }}>
            {entry.loading ? (
              <>
                <LineSkeleton width="55%" />
                <LineSkeleton width="75%" />
              </>
            ) : (
              <>
                {(profile?.filaments.length ?? 0) > 0 && <FilamentList filaments={profile!.filaments} />}
                {printer && <Fact icon={<PrintOutlinedIcon />}>{printer}</Fact>}
                {settings && <Fact icon={<TuneOutlinedIcon />}>{settings}</Fact>}
                {profile?.description && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    title={profile.description}
                    sx={{
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {profile.description}
                  </Typography>
                )}
              </>
            )}
            {plates.length > 1 && (
              <Stack direction="row" spacing={0.75} sx={{ pt: 0.5, flexWrap: "wrap", rowGap: 0.75 }}>
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
                      onClick={() => onPreviewPlate?.(entry.key, plate.index)}
                      aria-label={t("detail.profiles.previewPlate", { plate: plateName(t, plate.index, plate.name) })}
                      sx={{ borderRadius: 1.25 }}
                    >
                      <ProfilePlateThumb src={plate.thumb_url} size={52} index={plate.index} />
                    </ButtonBase>
                  </Tooltip>
                ))}
              </Stack>
            )}
          </Stack>
        </>
      )}
    </Box>
  );
}
