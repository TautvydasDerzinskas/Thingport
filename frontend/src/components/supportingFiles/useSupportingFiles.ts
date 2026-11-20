import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { UnauthorizedError } from "../../api/client";
import { type Print, type PrintFile, PrintApiError, printsApi } from "../../api/prints";
import { useConfirm } from "../ConfirmProvider";
import { useToast } from "../ToastProvider";
import { copyText } from "../../utils/clipboard";
import { saveResponseToDisk } from "../../utils/downloadResponse";
import { newLocalId } from "../../utils/localId";
import { holdsBackSliced, isPreparedName, sortAddedFiles, withGltfFiles } from "../../utils/addedFiles";
import { keepNotice, noticeOwner } from "../../utils/sessionNotices";

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

  // Each change answers with the whole model, so a model's go one at a time: an answer that set out first lands first,
  // never over a newer one. Each model has its own line, as one's answers don't touch another's: a slow upload to the
  // model before doesn't hold up the next one's. A line goes once it's empty.
  const turns = useRef(new Map<string, Promise<unknown>>());
  const inTurn = useCallback(<T>(model: string, task: () => Promise<T>): Promise<T> => {
    const next = (turns.current.get(model) ?? Promise.resolve()).then(task);
    const done = next.then(
      () => undefined,
      () => undefined,
    );
    turns.current.set(model, done);
    void done.then(() => {
      if (turns.current.get(model) === done) turns.current.delete(model);
    });
    return next;
  }, []);

  // A session that ended is said as the app says it, rather than by the request's own English.
  const reasonOf = useCallback(
    (err: unknown, fallback: string) =>
      err instanceof UnauthorizedError
        ? t("app:shell.sessionExpired")
        : err instanceof Error && err.message
          ? err.message
          : t(fallback),
    [t],
  );
  const failed = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      showToast({ message: reasonOf(err, fallback), severity: "error" });
    },
    [onUnauthorized, reasonOf, showToast],
  );

  /** One at a time, each shown as it goes; one that fails is said and the rest still go up, except the sliced prints
   *  after one whose answer was lost (holdsBackSliced), which are named to add again. A 3D file goes among the model's
   *  files, as Edit model puts it. */
  const upload = useCallback(
    async (files: File[], target: string | undefined = printId) => {
      if (!files.length || !target) return;
      const queued = files.map((file) => ({ key: newLocalId(), name: file.name, file }));
      setPending((current) => [...current, ...queued.map(({ key, name }) => ({ key, name, printId: target }))]);
      const settle = (done: { key: string }[]) => {
        const keys = new Set(done.map((item) => item.key));
        setPending((current) => current.filter((item) => !keys.has(item.key)));
      };
      // In line at once, before reading anything: a pick made after this one goes up after it.
      await inTurn(target, async () => {
        // A .gltf's .bin and textures go up with it, packed into its .glb.
        const { model, supporting, packedWith, ambiguous } = await withGltfFiles(
          sortAddedFiles(queued, "supporting"),
          (item) => item.file,
        );
        // Nothing of a pick whose .gltf names a file two picked files could be: the server couldn't tell which either,
        // and would keep the scene without it.
        if (ambiguous.length) {
          showToast({
            message: t("models:supporting.gltfAmbiguous", { names: ambiguous.join(", ") }),
            severity: "error",
          });
          settle(queued);
          return;
        }
        const packed = new Set([...packedWith.values()].flat());
        // Whose these are: a notice kept of them is that account's, not one another tab signed in meanwhile.
        const account = noticeOwner();
        let added = 0;
        let modelFilesAdded = false;
        // The first sliced print among them becomes the prepared print; the rest are kept as supporting files.
        let preparedAdded = false;
        // A toast after a failure's would close it at once: what went wrong is the one left showing.
        let anyFailed = false;
        // Each that wasn't added, and why: said once more with the sliced prints held back, if any are, as that message
        // is the last and would close the others' at once.
        const notAdded: string[] = [];
        const noteFailure = (name: string, err: unknown) =>
          notAdded.push(
            t("models:supporting.notAdded", {
              name,
              reason: reasonOf(err, "models:supporting.addFailed").replace(/[.。]\s*$/, ""),
            }),
          );
        if (model.length) {
          try {
            const { print: updated } = await printsApi.addPlates(
              target,
              model.map((item) => item.file),
            );
            onUpdated?.(updated);
            modelFilesAdded = true;
          } catch (err) {
            failed(err, "models:supporting.addFailed");
            noteFailure(model.map((item) => item.name).join(", "), err);
            anyFailed = true;
            if (err instanceof UnauthorizedError) {
              settle(queued);
              return;
            }
          } finally {
            settle(model);
          }
        }
        // The sliced prints after one whose answer was lost, which wait: each would replace it if it's in, or be kept
        // beside the old one if it isn't. Added again, it goes first, and they're kept beside it.
        const heldBack = new Set<(typeof supporting)[number]>();
        // Said once the rest have gone up, after any failure of theirs: what to add again, and in what order, is then the
        // message left showing, rather than one a later toast closes.
        let heldBackNotice: string | null = null;
        const sayHeldBack = () => {
          if (heldBackNotice) showToast({ message: [...notAdded, heldBackNotice].join(" "), severity: "error" });
        };
        for (const [index, item] of supporting.entries()) {
          if (heldBack.has(item)) {
            settle([item]);
            continue;
          }
          try {
            const { print: updated, prepared } = await printsApi.uploadFile(target, item.file, {
              keepPrepared: preparedAdded,
            });
            if (prepared) preparedAdded = true;
            onUpdated?.(updated);
            added += 1;
          } catch (err) {
            anyFailed = true;
            const status = err instanceof PrintApiError ? err.status : null;
            const after = supporting.slice(index + 1).filter((next) => isPreparedName(next.name));
            if (
              after.length &&
              !(err instanceof UnauthorizedError) &&
              holdsBackSliced(item.name, status, preparedAdded)
            ) {
              for (const next of after) heldBack.add(next);
              heldBackNotice = t("models:supporting.preparedHeldBack", {
                name: item.name,
                names: after.map((next) => next.name).join(", "),
              });
              continue;
            }
            failed(err, "models:supporting.addFailed");
            noteFailure(item.name, err);
            if (err instanceof UnauthorizedError) {
              // The session ended part-way: what's held back is said where signing in again, or the app starting over
              // on a renewed session, doesn't take it away with the toasts.
              if (heldBackNotice) keepNotice([...notAdded, heldBackNotice].join(" "), account);
              settle(queued);
              return;
            }
          } finally {
            settle([item]);
          }
        }
        sayHeldBack();
        if (anyFailed) return;
        // Where they went, as a 3D file isn't among the attachments it was added to.
        if (modelFilesAdded) {
          showToast({
            message: t("models:supporting.addedToModel", {
              files: model
                .filter((item) => !packed.has(item))
                .map((item) => item.name)
                .join(", "),
            }),
            severity: "success",
          });
        } else if (added) {
          showToast({ message: t("models:supporting.added", { count: added }), severity: "success" });
        }
      });
    },
    [failed, inTurn, onUpdated, printId, reasonOf, showToast, t],
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
      await inTurn(printId, async () => {
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
      await inTurn(printId, async () => {
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

  // The files on their way down, by id: another click on one doesn't start a second, and the rest stay free.
  const downloads = useRef(new Set<string>());
  const [downloading, setDownloading] = useState<ReadonlySet<string>>(() => new Set());
  const download = useCallback(
    async (file: PrintFile) => {
      if (downloads.current.has(file.id)) return;
      downloads.current.add(file.id);
      setDownloading(new Set(downloads.current));
      try {
        const res = await fetch(printsApi.supportingFileUrl(file));
        if (res.status === 401) throw new UnauthorizedError();
        if (!res.ok) throw new Error(t("models:detail.downloadFailed"));
        await saveResponseToDisk(res, file.filename);
      } catch (err) {
        failed(err, "models:detail.downloadFailed");
      } finally {
        downloads.current.delete(file.id);
        setDownloading(new Set(downloads.current));
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

  // The model the picker was opened for: what's picked goes there, though the page may show another by then.
  const pickedFor = useRef<string | undefined>(undefined);
  /** Opens the file picker; what's picked goes straight up. */
  const pick = useCallback(() => {
    pickedFor.current = printId;
    input?.click();
  }, [input, printId]);
  /** The input's change: its files go up, and it's emptied so the same file can be picked again. */
  const onPicked = useCallback(
    (picker: HTMLInputElement) => {
      const files = Array.from(picker.files ?? []);
      picker.value = "";
      void upload(files, pickedFor.current ?? printId);
    },
    [printId, upload],
  );

  return {
    uploading,
    upload,
    remove,
    rename,
    download,
    downloading,
    openInTab,
    copyLink,
    pick,
    onPicked,
    bindInput: setInput,
  };
}
