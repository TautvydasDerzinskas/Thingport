import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UnauthorizedError } from "../../api/client";
import { type Plate, type Print, printsApi } from "../../api/prints";
import { saveResponseToDisk } from "../../utils/downloadResponse";

/** Shared download logic for a Print: a single-plate model downloads its one file directly; a
 *  multi-plate one opens a picker (download-all-as-zip, or pick one plate) -- see
 *  DownloadPickerDialog. Used by both ModelActionsMenu's "Download" menu item and the model
 *  detail page's own big "Download model files" button, so the two behaviors can't drift apart.
 *  `recordUse` bumps the print count for the other ways of using a model (Open in {Slicer});
 *  every bump hands the updated print to `onRecorded` so the new count shows up immediately. */
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

  // Fire-and-forget: a failure to count a use must never look like the download/launch failed.
  // Only a real print is passed on: the frontend and backend images are published separately, and
  // a backend older than this endpoint's print response still answers `{ ok: true }` -- which,
  // handed to onRecorded as-is, would replace the whole print in the caller's state.
  const recordUse = () => {
    printsApi
      .recordDownload(print.id)
      .then(updated => {
        if (updated && typeof updated === "object" && updated.id === print.id) onRecorded?.(updated);
      })
      .catch(() => {});
  };

  const downloadPlate = async (plate: Plate) => {
    setDownloading(true);
    try {
      const res = await fetch(printsApi.fileUrl(plate.url));
      if (res.status === 401) throw new UnauthorizedError();
      if (!res.ok) throw new Error("Download failed");
      await saveResponseToDisk(res, plate.filename || "download");
      setPickerOpen(false);
      recordUse();
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
      recordUse();
    } catch (err) {
      handleDownloadError(err);
    } finally {
      setDownloading(false);
    }
  };

  const handleDownload = () => {
    if (print.plates.length <= 1) {
      const plate = print.plates[0];
      if (plate) void downloadPlate(plate);
      return;
    }
    setPickerOpen(true);
  };

  const sortedPlates = print.plates.toSorted((a, b) => a.position - b.position);

  return { pickerOpen, setPickerOpen, downloading, handleDownload, downloadPlate, downloadAllZip, sortedPlates, recordUse };
}
