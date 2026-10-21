import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import type { ApiTokenInfo } from "../../api/auth";
import McpPermissionsSection from "./McpPermissionsSection";

type Props = {
  open: boolean;
  onClose: () => void;
  info: ApiTokenInfo;
  onChange: (info: ApiTokenInfo) => void;
  onUnauthorized?: () => void;
};

/** What the API token may do, a section per way of using it. Only MCP for now; the REST API's
 *  permissions are meant to join it here. */
export default function ApiTokenPermissionsDialog({ open, onClose, info, onChange, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t("profile.apiToken.permissions.title")}</DialogTitle>
      <DialogContent>
        <Stack spacing={3}>
          <McpPermissionsSection info={info} onChange={onChange} onUnauthorized={onUnauthorized} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
