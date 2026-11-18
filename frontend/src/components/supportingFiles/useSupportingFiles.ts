import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { UnauthorizedError } from "../../api/client";
import { type Print, type PrintFile, PrintApiError, printsApi } from "../../api/prints";
import { useConfirm } from "../ConfirmProvider";
import { useToast } from "../ToastProvider";
import { copyText } from "../../utils/clipboard";
import { saveResponseToDisk } from "../../utils/downloadResponse";
import { newLocalId } from "../../utils/localId";
import { mayHoldPrepared, sortAddedFiles } from "../../utils/addedFiles";

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
  // Each with the model it's going to: the page stays as another model opens, and those still go up to the first.
  const [pending, setPending] = useState<(UploadingFile & { printId: string })[]>([]);
  const uploading = useMemo<UploadingFile[]>(
    () => pending.filter((item) => item.printId === printId).map(({ key, name }) => ({ key, name })),
    [pending, printId],
  );
  // The hidden file input the picker is, bound by the component that renders it.
  const [input, setInput] = useState<HTMLInputElement | null>(null);

  // Each change answers with the whole model, so they go one at a time: an answer that set out first lands first, never
  // over a newer one.
  const turn = useRef<Promise<unknown>>(Promise.resolve());
  const inTurn = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const next = turn.current.then(task);
    turn.current = next.catch(() => undefined);
    return next;
  }, []);

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

  /** One at a time, each shown as it goes; one that fails is said and the rest still go up. A 3D file goes among the
   *  model's files, as Edit model puts it. */
  const upload = useCallback(
    async (files: File[]) => {
      if (!files.length || !printId) return;
      const queued = files.map((file) => ({ key: newLocalId(), name: file.name, file }));
      setPending((current) => [...current, ...queued.map(({ key, name }) => ({ key, name, printId }))]);
      const settle = (done: { key: string }[]) => {
        const keys = new Set(done.map((item) => item.key));
        setPending((current) => current.filter((item) => !keys.has(item.key)));
      };
      const { model, supporting } = sortAddedFiles(queued, "supporting");
      await inTurn(async () => {
        let added = 0;
        let modelFilesAdded = false;
        // The first sliced print among them becomes the prepared print; the rest are kept as supporting files.
        let preparedAdded = false;
        // A toast after a failure's would close it at once: what went wrong is the one left showing.
        let anyFailed = false;
        if (model.length) {
          try {
            const { print: updated } = await printsApi.addPlates(
              printId,
              model.map((item) => item.file),
            );
            onUpdated?.(updated);
            modelFilesAdded = true;
          } catch (err) {
            failed(err, "models:supporting.addFailed");
            anyFailed = true;
            if (err instanceof UnauthorizedError) {
              settle(queued);
              return;
            }
          } finally {
            settle(model);
          }
        }
        for (const item of supporting) {
          try {
            const { print: updated, prepared } = await printsApi.uploadFile(printId, item.file, {
              keepPrepared: preparedAdded,
            });
            if (prepared) preparedAdded = true;
            onUpdated?.(updated);
            added += 1;
          } catch (err) {
            failed(err, "models:supporting.addFailed");
            anyFailed = true;
            if (err instanceof UnauthorizedError) {
              settle(queued);
              return;
            }
            // In for all the answer said, it keeps its place from the ones after it.
            if (mayHoldPrepared(item.name, err instanceof PrintApiError ? err.status : null)) preparedAdded = true;
          } finally {
            settle([item]);
          }
        }
        if (anyFailed) return;
        // Where they went, as a 3D file isn't among the attachments it was added to.
        if (modelFilesAdded) {
          showToast({
            message: t("models:supporting.addedToModel", { files: model.map((item) => item.name).join(", ") }),
            severity: "success",
          });
        } else if (added) {
          showToast({ message: t("models:supporting.added", { count: added }), severity: "success" });
        }
      });
    },
    [failed, inTurn, onUpdated, printId, showToast, t],
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
      await inTurn(async () => {
        try {
          const { print: updated } = await printsApi.deleteFile(printId, file.id);
          onUpdated?.(updated);
        } catch (err) {
          failed(err, "models:supporting.removeFailed");
        }
      });
    },
    [confirmDialog, failed, inTurn, onUpdated, printId, t],
  );

  const rename = useCallback(
    async (file: PrintFile, filename: string) => {
      if (!printId) return;
      await inTurn(async () => {
        try {
          const { print: updated } = await printsApi.renameFile(printId, file.id, filename);
          onUpdated?.(updated);
        } catch (err) {
          failed(err, "models:supporting.renameFailed");
        }
      });
    },
    [failed, inTurn, onUpdated, printId],
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
