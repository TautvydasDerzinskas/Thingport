import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { adminApi, type AdminUser } from "../../api/admin";
import { useToast } from "../../components/ToastProvider";

/** The whole account, or only its models. */
export type DeleteWhat = "account" | "models";

type Props = {
  user: AdminUser;
  what: DeleteWhat;
  onClose: () => void;
  onDeleted: () => void;
  onUnauthorized?: () => void;
};

const KEYS = {
  account: {
    title: "adminSettings.users.deleteTitle",
    warning: "adminSettings.users.deleteWarning",
    confirm: "adminSettings.users.deleteConfirm",
    done: "adminSettings.users.deleted",
    failed: "adminSettings.users.deleteFailed",
  },
  models: {
    title: "adminSettings.users.deleteModelsTitle",
    warning: "adminSettings.users.deleteModelsWarning",
    confirm: "adminSettings.users.deleteModelsConfirm",
    done: "adminSettings.users.modelsDeleted",
    failed: "adminSettings.users.deleteModelsFailed",
  },
} as const;

/** Can't be undone, so the admin types the user's email to confirm. */
export default function DeleteUserDialog({ user, what, onClose, onDeleted, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const showToast = useToast();
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = typed.trim().toLowerCase() === user.email.toLowerCase();
  const keys = KEYS[what];

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      const count =
        what === "account"
          ? (await adminApi.deleteUser(user.id)).models
          : (await adminApi.deleteUserModels(user.id)).deleted;
      showToast({ message: t(keys.done, { email: user.email, count }) });
      onDeleted();
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t(keys.failed));
      setDeleting(false);
    }
  };

  return (
    <Dialog open onClose={deleting ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t(keys.title, { name: user.display_name })}</DialogTitle>
      <DialogContent>
        <Alert severity="error" sx={{ mb: 2 }}>
          {t(keys.warning, { count: user.print_count })}
        </Alert>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {t("adminSettings.users.deleteTypeEmail", { email: user.email })}
        </Typography>
        <TextField
          fullWidth
          size="small"
          value={typed}
          placeholder={user.email}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && confirmed && !deleting) void remove();
          }}
          disabled={deleting}
          slotProps={{ htmlInput: { "aria-label": t("adminSettings.users.deleteTypeEmailLabel") } }}
        />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={deleting}>
          {t("common:cancel")}
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={() => void remove()}
          disabled={!confirmed || deleting}
          startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {t(keys.confirm)}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
