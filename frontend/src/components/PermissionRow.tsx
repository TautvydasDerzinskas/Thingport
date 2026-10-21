import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Segmented from "./controls/Segmented";
import PermissionTile from "./permissionAnimations/PermissionTile";

type Props = {
  /** Picks the tile's picture: an MCP tool's name or a REST scope's id. */
  name: string;
  title: string;
  description: string;
  allowed: boolean;
  disabled?: boolean;
  onChange: (allowed: boolean) => void;
};

/** One thing an API token may or may not do: its picture, what it is, and Deny / Allow. */
export default function PermissionRow({ name, title, description, allowed, disabled, onChange }: Props) {
  const { t } = useTranslation("app");
  const value = allowed ? "allow" : "deny";
  return (
    <Box
      className="permission-row"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        py: 0.75,
        "& + &": { borderTop: 1, borderColor: "divider" },
      }}
    >
      <PermissionTile name={name} allowed={allowed} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2">{title}</Typography>
        <Typography variant="caption" color="text.secondary" component="div">
          {description}
        </Typography>
      </Box>
      <Box sx={{ flexShrink: 0 }}>
        <Segmented
          label={title}
          value={value}
          disabled={disabled}
          onChange={(next) => next !== value && onChange(next === "allow")}
          options={[
            { value: "deny", label: t("profile.apiToken.permissions.deny") },
            { value: "allow", label: t("profile.apiToken.permissions.allow") },
          ]}
        />
      </Box>
    </Box>
  );
}
