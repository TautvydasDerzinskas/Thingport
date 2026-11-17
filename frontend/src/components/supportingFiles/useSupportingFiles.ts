import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { UnauthorizedError } from "../../api/client";
import { type Print, type PrintFile, printsApi } from "../../api/prints";
import { useConfirm } from "../ConfirmProvider";
import { useToast } from "../ToastProvider";
import { copyText } from "../../utils/clipboard";
import { saveResponseToDisk } from "../../utils/downloadResponse";
import { newLocalId } from "../../utils/localId";

/** A file on its way up, shown where the model's supporting files are until it's in. */
export type UploadingFile = { key: string; name: string };

/** The page address that opens the model with this file in its viewer: what "Copy link" copies, as the file's own
 *  address would carry a sign-in. */
export function supportingFileLink(printId: string, fileId: string): string {
  return `${window.location.origin}/models/${encodeURIComponent(printId)}?file=${encodeURIComponent(fileId)}`;
}

/** What can be done with a model's supporting files: add, rename, remove, download, open and share. By id, so a page
 *  can make it before its model has loaded. */
export function useSupportingFiles(
  printId: string | undefined,
  onUpdated?: (print: Print) => void,
  onUnauthorized?: () => void,
) {
  const { t } = useTranslation(["models", "common"]);
  const showToast = useToast();
  const confirmDialog = useConfirm();
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  // The hidden file input the picker is, bound by the component that renders it.
  const [input, setInput] = useState<HTMLInputElement | null>(null);

  const failed = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      showToast({ message: err instanceof Error && err.message ? err.message : t(fallback), severity: "error" });
    },
    [onUnauthorized, showToast, t],
  );

  /** One at a time, each shown as it goes; one that fails is said and the rest still go up. */
  const upload = useCallback(
    async (files: File[]) => {
      if (!files.length || !printId) return;
      const queued = files.map((file) => ({ key: newLocalId(), name: file.name }));
      setUploading((current) => [...current, ...queued]);
      let added = 0;
      for (const [index, file] of files.entries()) {
        try {
          const { print: updated } = await printsApi.uploadFile(printId, file);
          onUpdated?.(updated);
          added += 1;
        } catch (err) {
          failed(err, "models:supporting.addFailed");
          if (err instanceof UnauthorizedError) {
            setUploading((current) => current.filter((item) => !queued.includes(item)));
            return;
          }
        } finally {
          setUploading((current) => current.filter((item) => item.key !== queued[index].key));
        }
      }
      if (added) showToast({ message: t("models:supporting.added", { count: added }), severity: "success" });
    },
    [failed, onUpdated, printId, showToast, t],
  );

  const remove = useCallback(
    async (file: PrintFile) => {
      if (!printId) return;
      const confirmed = await confirmDialog({
        title: t("models:supporting.removeTitle"),
        message: t("models:supporting.removeMessage", { name: file.filename }),
        confirmLabel: t("common:remove"),
        destructive: true,
      });
      if (!confirmed) return;
      try {
        const { print: updated } = await printsApi.deleteFile(printId, file.id);
        onUpdated?.(updated);
      } catch (err) {
        failed(err, "models:supporting.removeFailed");
      }
    },
    [confirmDialog, failed, onUpdated, printId, t],
  );

  const rename = useCallback(
    async (file: PrintFile, filename: string) => {
      if (!printId) return;
      try {
        const { print: updated } = await printsApi.renameFile(printId, file.id, filename);
        onUpdated?.(updated);
      } catch (err) {
        failed(err, "models:supporting.renameFailed");
      }
    },
    [failed, onUpdated, printId],
  );

  const download = useCallback(
    async (file: PrintFile) => {
      try {
        const res = await fetch(printsApi.supportingFileUrl(file));
        if (res.status === 401) throw new UnauthorizedError();
        if (!res.ok) throw new Error(t("models:detail.downloadFailed"));
        await saveResponseToDisk(res, file.filename);
      } catch (err) {
        failed(err, "models:detail.downloadFailed");
      }
    },
    [failed, t],
  );

  /** A PDF, text or picture in a browser tab of its own; anything else downloads from there. */
  const openInTab = useCallback((file: PrintFile) => {
    window.open(printsApi.supportingFileUrl(file, true), "_blank", "noopener,noreferrer");
  }, []);

  const copyLink = useCallback(
    async (file: PrintFile) => {
      if (!printId) return;
      try {
        await copyText(supportingFileLink(printId, file.id));
        showToast({ message: t("models:supporting.linkCopied"), severity: "success" });
      } catch {
        showToast({ message: t("models:supporting.linkCopyFailed"), severity: "error" });
      }
    },
    [printId, showToast, t],
  );

  /** Opens the file picker; what's picked goes straight up. */
  const pick = useCallback(() => input?.click(), [input]);
  /** The input's change: its files go up, and it's emptied so the same file can be picked again. */
  const onPicked = useCallback(
    (picker: HTMLInputElement) => {
      const files = Array.from(picker.files ?? []);
      picker.value = "";
      void upload(files);
    },
    [upload],
  );

  return { uploading, upload, remove, rename, download, openInTab, copyLink, pick, onPicked, bindInput: setInput };
}
