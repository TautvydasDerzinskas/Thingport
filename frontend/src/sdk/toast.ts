import type { ToastOptions } from "../components/ToastProvider";
import type { SdkSeverity, SdkToastOptions } from "./types";

/**
 * A script's `ui.toast` as Thingport's own toast, with an optional button opening a model or the calling tool.
 */
export function scriptToast(
  message: unknown,
  severity: SdkSeverity,
  options: SdkToastOptions | undefined,
  open: { label: string; openModel: (id: string) => void; openWindow?: () => void },
): ToastOptions {
  const id = typeof options?.openModel === "string" ? options.openModel.trim() : "";
  const label = typeof options?.openWindow === "string" ? options.openWindow.trim() : "";
  const action = id
    ? { label: open.label, onClick: () => open.openModel(id) }
    : label && open.openWindow
      ? { label, onClick: open.openWindow }
      : undefined;
  if (!action) return { message: String(message), severity };
  return {
    message: String(message),
    severity,
    action,
    // Long enough to reach the button, as the toast after copying a model gives.
    autoHideMs: 8000,
  };
}
