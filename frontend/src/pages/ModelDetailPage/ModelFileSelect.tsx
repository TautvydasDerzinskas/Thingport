import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListSubheader from "@mui/material/ListSubheader";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import PrintIcon from "@mui/icons-material/Print";
import PlateThumbnail from "../../components/media/PlateThumbnail";
import { formatFileSize } from "../../utils/fileSize";
import { extOf } from "../../utils/fileExtensions";
import { folderLabel, groupByFolder, hasFolders, shortNames } from "../../utils/fileFolders";
import { fileRowText } from "./fileRowText";
import { PREPARED_KEY, type ModelFile } from "./useOpenInSlicer";

type Props = {
  files: ModelFile[];
  selected: ModelFile;
  onSelect: (file: ModelFile) => void;
};

// Every file without a plate but the prepared print is a partner's model's, which has no thumbnails here.
const isPrepared = (file: ModelFile) => !file.plate && file.key === PREPARED_KEY;

function FileIcon({ file }: { file: ModelFile }) {
  return file.plate ? (
    <PlateThumbnail plate={file.plate} />
  ) : (
    <Box sx={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {isPrepared(file) ? <PrintIcon fontSize="small" /> : <InsertDriveFileOutlinedIcon fontSize="small" />}
    </Box>
  );
}

const folderOf = (file: ModelFile) => file.folder;

/** A folder's heading in the list: its name, and how many of the files are in it. */
function FolderHeading({ folder, count }: { folder: string; count: number }) {
  return (
    <ListSubheader
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        lineHeight: "32px",
        fontSize: "0.72rem",
        fontWeight: 700,
        color: "text.secondary",
        bgcolor: "background.paper",
        "& svg": { fontSize: 15 },
      }}
    >
      <FolderOutlinedIcon aria-hidden />
      <Box
        component="span"
        sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {folderLabel(folder)}
      </Box>
      <Box component="span" sx={{ fontWeight: 500 }}>
        {count}
      </Box>
    </ListSubheader>
  );
}

/** The file the side panel's open and download actions apply to, for a model with several. Files in folders are
 *  listed under a heading for each, after those in none, with the start every name in a folder shares left off. */
export default function ModelFileSelect({ files, selected, onSelect }: Props) {
  const { t } = useTranslation(["models"]);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const names = useMemo(
    () =>
      shortNames(
        files,
        (file) => file.key,
        (file) => file.filename,
        folderOf,
      ),
    [files],
  );
  const grouped = hasFolders(files, folderOf);
  /** `listed`: under its folder's heading, which then needn't be said again. */
  const textOf = (file: ModelFile, listed: boolean) => {
    if (isPrepared(file)) return { primary: t("models:detail.preparedPrintFile"), secondary: file.filename };
    const size = typeof file.size === "number" ? formatFileSize(file.size) : null;
    if (file.folder) {
      const type = extOf(file.filename).toUpperCase() || null;
      return {
        primary: names.get(file.key) ?? file.filename,
        secondary: [listed ? null : folderLabel(file.folder), type, size].filter(Boolean).join(" · "),
      };
    }
    const text = fileRowText(t, file.filename, file.index);
    return size ? { ...text, secondary: `${text.secondary} · ${size}` } : text;
  };
  const current = textOf(selected, false);
  const row = (file: ModelFile) => (
    <MenuItem
      key={file.key}
      selected={file.key === selected.key}
      title={file.filename}
      onClick={() => {
        onSelect(file);
        setAnchor(null);
      }}
      sx={file.folder ? { pl: 2.5 } : undefined}
    >
      <ListItemIcon sx={{ minWidth: 44 }}>
        <FileIcon file={file} />
      </ListItemIcon>
      <ListItemText
        {...textOf(file, true)}
        primaryTypographyProps={{ variant: "body2", noWrap: true }}
        secondaryTypographyProps={{ variant: "caption", noWrap: true }}
      />
    </MenuItem>
  );

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
        {t("models:detail.fileSelectLabel", { count: files.length })}
      </Typography>
      <ButtonBase
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        aria-label={t("models:detail.fileSelectAria", { file: current.primary })}
        title={selected.filename}
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
          transition: "border-color 150ms",
          "&:hover": { borderColor: "text.secondary" },
          "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: 1 },
        }}
      >
        <FileIcon file={selected} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" fontWeight={600} noWrap>
            {current.primary}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            component="div"
            sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
          >
            {selected.folder && !isPrepared(selected) && (
              <FolderOutlinedIcon aria-hidden sx={{ fontSize: 13, flexShrink: 0 }} />
            )}
            <Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
              {current.secondary}
            </Box>
          </Typography>
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
        slotProps={{ paper: { sx: { width: anchor?.offsetWidth, maxHeight: grouped ? 420 : 360 } } }}
        MenuListProps={grouped ? { sx: { pt: 0 } } : undefined}
      >
        {grouped
          ? groupByFolder(files, folderOf).flatMap((group) => [
              ...(group.folder
                ? [<FolderHeading key={`folder:${group.folder}`} folder={group.folder} count={group.items.length} />]
                : []),
              ...group.items.map(row),
            ])
          : files.map(row)}
      </Menu>
    </Box>
  );
}
