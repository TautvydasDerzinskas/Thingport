import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import { type Print, printsApi } from "../../api/prints";
import OverlayPane from "./OverlayPane";

type Props = {
  print: Print;
  /** The model's scripts, and which of them is loaded. */
  scripts: { id: string; filename: string }[];
  scriptId: string;
  onScriptChange: (id: string) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  disabled?: boolean;
};

/** The model being customised: what it is, and which of its scripts is open. */
export default function ModelPane({
  print,
  scripts,
  scriptId,
  onScriptChange,
  collapsed,
  onCollapsedChange,
  disabled,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  // The gallery's main image, or the first plate's thumbnail where there is no gallery yet.
  const image = print.preview_images[0]?.url ?? print.thumb_url ?? null;
  const title = print.title || print.name;

  return (
    <OverlayPane
      title={t("models:customizer.model.title")}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      // Folded, the pane keeps the one thing it must never lose: which model is being customised.
      whenCollapsed={
        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
      }
    >
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1.25} alignItems="flex-start">
          <Box
            sx={{
              width: 64,
              height: 64,
              flexShrink: 0,
              borderRadius: 1.5,
              overflow: "hidden",
              bgcolor: "action.hover",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "text.disabled",
            }}
          >
            {image ? (
              <Box
                component="img"
                src={printsApi.fileUrl(image)}
                alt=""
                loading="lazy"
                sx={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <DescriptionOutlinedIcon fontSize="small" />
            )}
          </Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.35, wordBreak: "break-word" }}>
            {title}
          </Typography>
        </Stack>

        {/* Only where there is a choice to make: one script needs no picker, it is named in the Customize pane. */}
        {scripts.length > 1 && (
          <TextField
            select
            size="small"
            fullWidth
            disabled={disabled}
            label={t("models:customizer.model.script")}
            value={scriptId}
            onChange={(event) => onScriptChange(event.target.value)}
          >
            {scripts.map((script) => (
              <MenuItem key={script.id} value={script.id}>
                {script.filename}
              </MenuItem>
            ))}
          </TextField>
        )}

        {print.notes ? (
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              whiteSpace: "pre-wrap",
              // Long enough to be worth reading, short enough to leave the controls below in view.
              maxHeight: 132,
              overflowY: "auto",
            }}
          >
            {print.notes}
          </Typography>
        ) : (
          <Typography variant="body2" sx={{ color: "text.disabled" }}>
            {t("models:detail.noDescription")}
          </Typography>
        )}
      </Stack>
    </OverlayPane>
  );
}
