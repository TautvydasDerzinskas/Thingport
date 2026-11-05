import React from "react";
import { useTranslation } from "react-i18next";
import Snackbar from "@mui/material/Snackbar";
import Alert, { type AlertColor } from "@mui/material/Alert";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CloseIcon from "@mui/icons-material/Close";

export type ToastOptions = {
  message: string;
  severity?: AlertColor;
  /** A button on the toast, which also closes it. */
  action?: { label: string; onClick: () => void };
  /** How long it stays; an action needs longer than the usual 4s to reach. */
  autoHideMs?: number;
};

type QueuedToast = ToastOptions & { key: number };

const ToastContext = React.createContext<((options: ToastOptions) => void) | null>(null);
const CurrentToastContext = React.createContext<QueuedToast | null>(null);

let nextKey = 0;

/** Queues toasts one at a time. Mounted once in AppLayout. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("common");
  const [queue, setQueue] = React.useState<QueuedToast[]>([]);
  const [current, setCurrent] = React.useState<QueuedToast | null>(null);
  const [open, setOpen] = React.useState(false);

  const showToast = React.useCallback((options: ToastOptions) => {
    setQueue((prev) => [...prev, { ...options, key: nextKey++ }]);
  }, []);

  React.useEffect(() => {
    if (queue.length && !current) {
      setCurrent(queue[0]);
      setQueue((prev) => prev.slice(1));
      setOpen(true);
    } else if (queue.length && current && open) {
      setOpen(false);
    }
  }, [queue, current, open]);

  const handleClose = (_event: unknown, reason?: string) => {
    if (reason === "clickaway") return;
    setOpen(false);
  };

  return (
    <ToastContext.Provider value={showToast}>
      <CurrentToastContext.Provider value={current}>{children}</CurrentToastContext.Provider>
      <Snackbar
        key={current?.key}
        open={open}
        autoHideDuration={current?.autoHideMs ?? 4000}
        onClose={handleClose}
        slotProps={{ transition: { onExited: () => setCurrent(null) } }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setOpen(false)}
          // Alert renders an action instead of its close button, never both.
          action={
            current?.action && (
              <>
                <Button
                  color="inherit"
                  size="small"
                  sx={{ whiteSpace: "nowrap", minHeight: { xs: 44, md: 0 } }}
                  onClick={() => {
                    setOpen(false);
                    current.action?.onClick();
                  }}
                >
                  {current.action.label}
                </Button>
                <Tooltip title={t("close")}>
                  <IconButton
                    color="inherit"
                    size="small"
                    aria-label={t("close")}
                    onClick={() => setOpen(false)}
                    sx={{ width: { xs: 44, md: 30 }, height: { xs: 44, md: 30 } }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            )
          }
          severity={current?.severity ?? "success"}
          variant="filled"
          sx={{ width: "100%" }}
        >
          {current?.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const showToast = React.useContext(ToastContext);
  if (!showToast) throw new Error("useToast must be used within a ToastProvider");
  return showToast;
}

/** The toast on screen, for what has to say it again. */
export function useCurrentToast() {
  return React.useContext(CurrentToastContext);
}
