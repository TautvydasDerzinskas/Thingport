import type { ToastOptions } from "../components/ToastProvider";
import type { SdkSeverity, SdkToastOptions } from "./types";

/**
 * A script's `ui.toast` as Thingport's own toast: a model to open puts an Open button on it, which leaves for the
 * model's page the way the host does (a tool's window closes first).
 */
export function scriptToast(
  message: unknown,
  severity: SdkSeverity,
  options: SdkToastOptions | undefined,
  open: { label: string; openModel: (id: string) => void },
): ToastOptions {
  const id = typeof options?.openModel === "string" ? options.openModel.trim() : "";
  if (!id) return { message: String(message), severity };
  return {
    message: String(message),
    severity,
    action: { label: open.label, onClick: () => open.openModel(id) },
    // Long enough to reach the button, as the toast after copying a model gives.
    autoHideMs: 8000,
  };
}
