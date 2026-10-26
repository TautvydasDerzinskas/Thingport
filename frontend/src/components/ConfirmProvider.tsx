import React from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";

export type ConfirmOptions = {
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

/** true: confirmed; false: the cancel button; null: dismissed (Escape or a click outside). */
export type ConfirmResult = boolean | null;

type PendingConfirm = ConfirmOptions & { resolve: (result: ConfirmResult) => void };

const ConfirmContext = React.createContext<((options: ConfirmOptions) => Promise<ConfirmResult>) | null>(null);

/** Replaces `window.confirm` with one shared dialog. Mounted once in AppLayout. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("common");
  const [pending, setPending] = React.useState<PendingConfirm | null>(null);

  const confirm = React.useCallback((options: ConfirmOptions) => {
    return new Promise<ConfirmResult>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const settle = (result: ConfirmResult) => {
    pending?.resolve(result);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={Boolean(pending)} onClose={() => settle(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{pending?.title || t("confirm")}</DialogTitle>
        <DialogContent>
          {/* A div, not a <p>, so a message can hold blocks such as a card. */}
          <DialogContentText component="div">{pending?.message}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => settle(false)}>{pending?.cancelLabel || t("cancel")}</Button>
          <Button variant="contained" color={pending?.destructive ? "error" : "primary"} onClick={() => settle(true)}>
            {pending?.confirmLabel || (pending?.destructive ? t("delete") : t("confirm"))}
          </Button>
        </DialogActions>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/** Resolves with the user's choice; a dismissal is falsy too, so `if (!confirmed)` treats it as cancel. */
export function useConfirm() {
  const confirm = React.useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used within a ConfirmProvider");
  return confirm;
}
