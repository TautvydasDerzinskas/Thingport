import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { UnauthorizedError } from "../../api/client";
import { type Plate, type Print, printsApi } from "../../api/prints";
import { saveResponseToDisk } from "../../utils/downloadResponse";

/** A model with one file downloads it directly; one with more (plates or supporting files) opens a picker.
 *  `recordUse` records an Open in {Slicer}. The count a download records goes to `onCounted` where the owner of the
 *  model can put it in the model as it is by then, else into the model as this has it, through `onRecorded`. */
export function useDownloadPrint(
  print: Print,
  onUnauthorized?: () => void,
  onRecorded?: (print: Print) => void,
  onCounted?: (printId: string, printCount: number) => void,
) {
  const { t } = useTranslation(["models"]);
  // Both kept with the model they're of, as the page header keeps its menu across models: a download still on its way
  // for the one before holds neither the next one's controls nor its picker, and one clicked again is still held.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<readonly string[]>([]);
  const pickerOpen = pickerFor === print.id;
  const downloading = busy.includes(print.id);
  // Closed on leaving the model, rather than open again on coming back to it.
  useEffect(() => {
    setPickerFor((open) => (open === print.id ? open : null));
  }, [print.id]);
  const setPickerOpen = (open: boolean) => setPickerFor(open ? print.id : null);

  const handleDownloadError = (err: unknown) => {
    if (err instanceof UnauthorizedError) {
      onUnauthorized?.();
      return;
    }
    console.error(err);
    alert(t("models:detail.downloadFailed"));
  };

  // The model as the page has it now, for an answer that comes back after it changed.
  const current = useRef(print);
  useEffect(() => {
    current.current = print;
  });

  // Fire-and-forget. Only a real print is passed on: an older backend answers `{ ok: true }`. Only the count it
  // records is taken from it, into the model as it is by then: a rename made while it was on its way stays.
  const record = (kind: "download" | "slicer") => {
    printsApi
      .recordDownload(print.id, kind)
      .then((updated) => {
        if (!updated || typeof updated !== "object" || updated.id !== print.id) return;
        // The owner of the model's state puts it in as it is when this lands, which a change queued just before (a
        // file added) may not have reached this hook's copy of yet.
        if (onCounted) return onCounted(updated.id, updated.print_count);
        // Two downloads' answers can land in either order, and the count only grows. Kept here at once too: a second
        // answer landing before the page has drawn this one measures from it, not from the count before both.
        const now = current.current;
        if (now.id !== updated.id) return onRecorded?.(updated);
        const next = { ...now, print_count: Math.max(now.print_count, updated.print_count) };
        current.current = next;
        onRecorded?.(next);
      })
      .catch(() => {});
  };
  const recordUse = () => record("slicer");
  /** A download made elsewhere, such as an adapted copy's. */
  const recordDownload = () => record("download");

  /** Counted against the model it was started on, until it's done, wherever the page has gone meanwhile. */
  const whileBusy = async (id: string, task: () => Promise<void>) => {
    setBusy((ids) => [...ids, id]);
    try {
      await task();
    } catch (err) {
      handleDownloadError(err);
    } finally {
      setBusy((ids) => {
        const at = ids.indexOf(id);
        return at < 0 ? ids : ids.toSpliced(at, 1);
      });
    }
  };
  // Done: its picker closes, unless it's since closed or opened for another model.
  const done = (id: string) => {
    setPickerFor((open) => (open === id ? null : open));
    record("download");
  };

  /** A plate, or any other of the model's files, such as its prepared print. */
  const downloadFile = (file: Pick<Plate, "url" | "filename">) =>
    whileBusy(print.id, async () => {
      const res = await fetch(printsApi.fileUrl(file.url));
      if (res.status === 401) throw new UnauthorizedError();
      if (!res.ok) throw new Error("Download failed");
      await saveResponseToDisk(res, file.filename || "download");
      done(print.id);
    });

  /** `folder`: only the files in that folder of the model (Plate.folder) and the folders in it. */
  const downloadAllZip = (folder?: string) =>
    whileBusy(print.id, async () => {
      const name = print.name || "model";
      // Named by the server, which otherwise calls every zip "thingport.zip".
      const filename = folder ? `${name} - ${folder.split("/").pop()}.zip` : `${name}.zip`;
      const res = await printsApi.downloadZip({ print_ids: [print.id], filename, ...(folder ? { folder } : {}) });
      await saveResponseToDisk(res, filename);
      done(print.id);
    });

  const handleDownload = () => {
    // A lone plate downloads as it is, unless there are supporting files to choose among too.
    if (print.plates.length <= 1 && !print.supporting_file_count) {
      const plate = print.plates[0];
      if (plate) void downloadFile(plate);
      return;
    }
    setPickerOpen(true);
  };

  const sortedPlates = print.plates.toSorted((a, b) => a.position - b.position);

  return {
    pickerOpen,
    setPickerOpen,
    downloading,
    handleDownload,
    downloadFile,
    downloadPlate: downloadFile,
    downloadAllZip,
    sortedPlates,
    recordUse,
    recordDownload,
  };
}
