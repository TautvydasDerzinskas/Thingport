import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UnauthorizedError } from "../../api/client";
import { type Plate, type Print, printsApi } from "../../api/prints";
import { saveResponseToDisk } from "../../utils/downloadResponse";

/** A single-plate model downloads directly; multi-plate opens a picker. `recordUse` records an
 *  Open in {Slicer}. */
export function useDownloadPrint(print: Print, onUnauthorized?: () => void, onRecorded?: (print: Print) => void) {
  const { t } = useTranslation(["models"]);
  const [pickerOpen, setPickerOpen] = useState(false);
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

  const downloadAllZip = async () => {
    setDownloading(true);
    try {
      const res = await printsApi.downloadZip({ print_ids: [print.id] });
      await saveResponseToDisk(res, `${print.name || "model"}.zip`);
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
  };
}
