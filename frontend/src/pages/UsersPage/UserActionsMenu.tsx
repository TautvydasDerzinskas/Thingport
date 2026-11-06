import { useState } from "react";
import { useTranslation } from "react-i18next";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DeleteSweepOutlinedIcon from "@mui/icons-material/DeleteSweepOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import { UnauthorizedError } from "../../api/client";
import { adminApi, type AdminUser } from "../../api/admin";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import DeleteUserDialog, { type DeleteWhat } from "./DeleteUserDialog";

type Props = {
  user: AdminUser;
  /** After a change, so the list shows it. */
  onChanged: () => void;
  onUnauthorized?: () => void;
};

/** Only what the viewing admin may do to this user, as the server says: roles, then the destructive ones. */
export default function UserActionsMenu({ user, onChanged, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const showToast = useToast();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [deleting, setDeleting] = useState<DeleteWhat | null>(null);
  if (!user.can_promote && !user.can_demote && !user.can_delete && !user.can_delete_models) return null;
  const canChangeRole = user.can_promote || user.can_demote;

  const openDelete = (what: DeleteWhat) => {
    setAnchor(null);
    setDeleting(what);
  };

  const changeRole = async (role: AdminUser["role"]) => {
    setAnchor(null);
    const promote = role === "ADMIN";
    const ok = await confirm({
      title: t(promote ? "adminSettings.users.promoteTitle" : "adminSettings.users.demoteTitle", {
        name: user.display_name,
      }),
      message: t(promote ? "adminSettings.users.promoteMessage" : "adminSettings.users.demoteMessage"),
      confirmLabel: t(promote ? "adminSettings.users.promote" : "adminSettings.users.demote"),
    });
    if (!ok) return;
    try {
      await adminApi.setUserRole(user.id, role);
      showToast({
        message: t(promote ? "adminSettings.users.promoted" : "adminSettings.users.demoted", { email: user.email }),
      });
      onChanged();
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    }
  };

  return (
    <>
      <Tooltip title={t("common:moreActions")}>
        <IconButton
          size="small"
          aria-label={t("common:moreActions")}
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {user.can_promote && (
          <MenuItem onClick={() => void changeRole("ADMIN")}>
            <ListItemIcon>
              <AdminPanelSettingsOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("adminSettings.users.promote")}</ListItemText>
          </MenuItem>
        )}
        {user.can_demote && (
          <MenuItem onClick={() => void changeRole("MEMBER")}>
            <ListItemIcon>
              <PersonOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("adminSettings.users.demote")}</ListItemText>
          </MenuItem>
        )}
        {canChangeRole && (user.can_delete_models || user.can_delete) && <Divider />}
        {user.can_delete_models && (
          <MenuItem onClick={() => openDelete("models")} disabled={user.print_count === 0} sx={{ color: "error.main" }}>
            <ListItemIcon sx={{ color: "inherit" }}>
              <DeleteSweepOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("adminSettings.users.deleteModels")}</ListItemText>
          </MenuItem>
        )}
        {user.can_delete && (
          <MenuItem onClick={() => openDelete("account")} sx={{ color: "error.main" }}>
            <ListItemIcon sx={{ color: "inherit" }}>
              <DeleteOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("adminSettings.users.delete")}</ListItemText>
          </MenuItem>
        )}
      </Menu>
      {deleting && (
        <DeleteUserDialog
          user={user}
          what={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            onChanged();
          }}
          onUnauthorized={onUnauthorized}
        />
      )}
    </>
  );
}
