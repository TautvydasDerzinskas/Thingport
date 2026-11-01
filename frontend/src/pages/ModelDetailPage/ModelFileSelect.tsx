import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import PrintIcon from "@mui/icons-material/Print";
import PlateThumbnail from "../../components/media/PlateThumbnail";
import { fileRowText } from "./fileRowText";
import type { ModelFile } from "./useOpenInSlicer";

type Props = {
  files: ModelFile[];
  selected: ModelFile;
  onSelect: (file: ModelFile) => void;
};

function FileIcon({ file }: { file: ModelFile }) {
  return file.plate ? (
    <PlateThumbnail plate={file.plate} />
  ) : (
    <Box sx={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <PrintIcon fontSize="small" />
    </Box>
  );
}

/** The file the side panel's open and download actions apply to, for a model with several. */
export default function ModelFileSelect({ files, selected, onSelect }: Props) {
  const { t } = useTranslation(["models"]);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const textOf = (file: ModelFile) =>
    file.plate
      ? fileRowText(t, file.filename, file.index, file.plate.profile)
      : { primary: t("models:detail.preparedPrintFile"), secondary: file.filename };
  const current = textOf(selected);

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
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
            {current.secondary}
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
        slotProps={{ paper: { sx: { width: anchor?.offsetWidth, maxHeight: 360 } } }}
      >
        {files.map((file) => (
          <MenuItem
            key={file.key}
            selected={file.key === selected.key}
            title={file.filename}
            onClick={() => {
              onSelect(file);
              setAnchor(null);
            }}
          >
            <ListItemIcon sx={{ minWidth: 44 }}>
              <FileIcon file={file} />
            </ListItemIcon>
            <ListItemText
              {...textOf(file)}
              primaryTypographyProps={{ variant: "body2", noWrap: true }}
              secondaryTypographyProps={{ variant: "caption", noWrap: true }}
            />
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
