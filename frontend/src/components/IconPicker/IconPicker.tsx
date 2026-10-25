import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import IconBrowserDialog from "./IconBrowserDialog";
import { useIconCatalog } from "./iconCatalog";

type Props = {
  label: string;
  /** A stored icon: `builtin:<group>/<name>`, an uploaded icon's path, an image's web address, or empty for none. */
  value: string;
  onChange: (value: string) => void;
  /** The icon as the place it's for draws it; it's given the stored value, so it shows the fallback for none. */
  preview: React.ReactNode;
  /** What having no icon means, such as "the site's own icon". */
  emptyLabel: string;
  disabled?: boolean;
  /** Said under the field, as a text field's helper text says an error. */
  error?: string;
};

/** An icon field: what's picked, a button opening the icon browser, and one to clear it. */
export default function IconPicker({ label, value, onChange, preview, emptyLabel, disabled, error }: Props) {
  const { t } = useTranslation("app");
  const catalog = useIconCatalog();
  const [open, setOpen] = React.useState(false);
  const name = !value
    ? emptyLabel
    : (catalog.find((icon) => icon.value === value)?.name ??
      (value.startsWith("/api/icons/") ? t("iconPicker.uploadedIcon") : value));

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          minWidth: 0,
          px: 1,
          py: 0.75,
          border: 1,
          borderColor: error ? "error.main" : "divider",
          borderRadius: 1,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Box sx={{ flexShrink: 0, display: "flex" }}>{preview}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" component="div">
            {label}
          </Typography>
          <Typography variant="body2" noWrap title={name}>
            {name}
          </Typography>
        </Box>
        {value && !disabled && (
          <Tooltip title={t("iconPicker.clear")}>
            <IconButton size="small" aria-label={t("iconPicker.clear")} onClick={() => onChange("")}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Button
          size="small"
          variant="outlined"
          disabled={disabled}
          onClick={() => setOpen(true)}
          sx={{ flexShrink: 0 }}
        >
          {t("iconPicker.choose")}
        </Button>
        <IconBrowserDialog open={open} value={value} onClose={() => setOpen(false)} onPick={onChange} />
      </Box>
      {error && (
        <Typography variant="caption" color="error" component="p" sx={{ mt: 0.5, mx: 1.75 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
