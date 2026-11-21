import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UnauthorizedError } from "../../api/client";
import { type Plate, type Print, printsApi } from "../../api/prints";
import { saveResponseToDisk } from "../../utils/downloadResponse";

/** A single-plate model downloads directly; multi-plate opens a picker. `recordUse` records an
 *  Open in {Slicer}. */
export function useDownloadPrint(print: Print, onUnauthorized?: () => void, onRecorded?: (print: Print) => void) {
  const { t } = useTranslation(["models"]);
  // The page header keeps this across models: the picker is open for the model it was opened on, leaving that model
  // closes it, and a download of that model finishing later closes only its own.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  if (pickerFor !== null && pickerFor !== print.id) setPickerFor(null);
  const pickerOpen = pickerFor === print.id;
  const setPickerOpen = (open: boolean) =>
    setPickerFor((current) => (open ? print.id : current === print.id ? null : current));
  const [downloading, setDownloading] = useState(false);

  const handleDownloadError = (err: unknown) => {
    if (err instanceof UnauthorizedError) {
      onUnauthorized?.();
      return;
    }
    console.error(err);
    alert(t("models:detail.downloadFailed"));
  };

  // Fire-and-forget. Only a real print is passed on: an older backend answers `{ ok: true }`.
  const record = (kind: "download" | "slicer") => {
    printsApi
      .recordDownload(print.id, kind)
      .then((updated) => {
        if (updated && typeof updated === "object" && updated.id === print.id) onRecorded?.(updated);
      })
      .catch(() => {});
  };
  const recordUse = () => record("slicer");
  /** A download made elsewhere, such as an adapted copy's. */
  const recordDownload = () => record("download");

  /** A plate, or any other of the model's files, such as its prepared print. */
  const downloadFile = async (file: Pick<Plate, "url" | "filename">) => {
    setDownloading(true);
    try {
      const res = await fetch(printsApi.fileUrl(file.url));
      if (res.status === 401) throw new UnauthorizedError();
      if (!res.ok) throw new Error("Download failed");
      await saveResponseToDisk(res, file.filename || "download");
      setPickerOpen(false);
      record("download");
    } catch (err) {
      handleDownloadError(err);
    } finally {
      setDownloading(false);
    }
  };

  /** `folder`: only the files in that folder of the model (Plate.folder) and the folders in it. */
  const downloadAllZip = async (folder?: string) => {
    setDownloading(true);
    try {
      const name = print.name || "model";
      // Named by the server, which otherwise calls every zip "thingport.zip".
      const filename = folder ? `${name} - ${folder.split("/").pop()}.zip` : `${name}.zip`;
      const res = await printsApi.downloadZip({ print_ids: [print.id], filename, ...(folder ? { folder } : {}) });
      await saveResponseToDisk(res, filename);
      setPickerOpen(false);
      record("download");
    } catch (err) {
      handleDownloadError(err);
    } finally {
      setDownloading(false);
    }
  };

  const handleDownload = () => {
    if (print.plates.length <= 1) {
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
