import type { CaptchaAnswer } from "../../api/captcha";
import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { UnauthorizedError } from "../../api/client";
import { importsApi, type MakerworldProfileScope } from "../../api/imports";
import { printsApi, type Print } from "../../api/prints";
import { useNotifications } from "../Layout/NotificationsContext";
import {
  entriesFromFileList,
  hasModelFolders,
  isSystemFile,
  uploadEntriesToCategory,
  uploadFoldersAsModels,
} from "../../utils/uploadTree";
import { buildUploadEntriesFromZip, isZipFile, readZipEntries } from "../../utils/zipUtils";
import { useZipImportPrompt } from "./ZipImportModal";
import { useCollectionImportPrompt } from "./CollectionImportModal";
import { useImportModePrompt, type ImportMode } from "./ImportModeModal";
import { useImportJob } from "../Layout/ImportJobContext";
import { UPLOAD_EXTS } from "../../constants/fileTypes";
import { useToast } from "../ToastProvider";
import {
  filesNeedGrab,
  hasPrintProfiles,
  isGrabOnlyList,
  listLinkOf,
  mayBeRawFilesZip,
  modelLinkOf,
} from "../../utils/importLinkDetection";

// A folder pick always prefixes relativePath with the folder name.
function isFlatFileSet(entries: { file: File; relativePath: string }[]) {
  return entries.length > 1 && entries.every((entry) => entry.relativePath === entry.file.name);
}

type Props = {
  onUploaded: () => void;
  categoryId?: string | null;
  onUnauthorized?: () => void;
};

/** `modals` must be rendered by the caller alongside the menu. */
export function useUploadImport({ onUploaded, categoryId, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const showToast = useToast();
  const { refresh: refreshNotifications } = useNotifications();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const zipPrompt = useZipImportPrompt();
  const collectionPrompt = useCollectionImportPrompt();
  const importModePrompt = useImportModePrompt();
  const { startSingleImport, startZipImport, startListImport, startProfilesImport, startLinksImport } = useImportJob();
  const isBusy = uploading || importing || zipPrompt.isOpen || collectionPrompt.isOpen || importModePrompt.isOpen;

  // A plain upload has no metadata yet, so open it straight in edit mode.
  const openForEditing = (print: Print) => {
    navigate(`/models/${print.id}?edit=${print.id}`);
  };

  const uploadFlatAsMultiplate = async (files: File[]) => {
    try {
      const result = await printsApi.upload(files, { category_id: categoryId || undefined, mode: "multiplate" });
      return { uploaded: result.prints.length, failed: [] as string[], prints: result.prints };
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return { uploaded: 0, failed: [] as string[], prints: [] as Print[] };
      }
      const message = err instanceof Error ? err.message.trim() : "";
      return {
        uploaded: 0,
        failed: [
          message
            ? t("uploadBar.multiplateImportFailedWithMessage", { message })
            : t("uploadBar.multiplateImportFailed"),
        ],
        prints: [] as Print[],
      };
    }
  };

  const uploadEntries = async (entries: ReturnType<typeof entriesFromFileList>) => {
    if (!entries.length) return;
    setUploading(true);
    const normalEntries = entries.filter((entry) => !isZipFile(entry.file.name));
    const zipEntries = entries.filter((entry) => isZipFile(entry.file.name));
    let uploaded = 0;
    const failed: string[] = [];
    const prints: Print[] = [];
    // Batches upload without a notification per request; they get one summary at the end.
    const batchPrintIds: string[] = [];
    const batchFailed: string[] = [];
    let batched = false;
    const applyResult = (result: { uploaded: number; failed: string[]; prints?: Print[]; batched?: boolean }) => {
      uploaded += result.uploaded;
      failed.push(...result.failed);
      if (result.prints) prints.push(...result.prints);
      if (result.batched) {
        batched = true;
        batchPrintIds.push(...(result.prints ?? []).map((p) => p.id));
        batchFailed.push(...result.failed);
      }
    };
    if (normalEntries.length) {
      if (isFlatFileSet(normalEntries)) {
        await importModePrompt.prompt({
          label: normalEntries.map((entry) => entry.file.name).join(", "),
          count: normalEntries.length,
          onChoose: async (mode: ImportMode) => {
            if (mode === "multiplate") {
              applyResult(await uploadFlatAsMultiplate(normalEntries.map((entry) => entry.file)));
            } else {
              applyResult(await uploadEntriesToCategory(normalEntries, categoryId || null, onUnauthorized));
            }
          },
        });
      } else if (hasModelFolders(normalEntries)) {
        // Libraries often keep one model per folder, split into several files with its photos alongside.
        const roots = [...new Set(normalEntries.map((entry) => entry.relativePath.split("/")[0]))];
        await importModePrompt.prompt({
          label: roots.join(", "),
          count: normalEntries.length,
          variant: "folders",
          onChoose: async (mode: ImportMode) => {
            const upload = mode === "multiplate" ? uploadFoldersAsModels : uploadEntriesToCategory;
            applyResult(await upload(normalEntries, categoryId || null, onUnauthorized));
          },
        });
      } else {
        const result = await uploadEntriesToCategory(normalEntries, categoryId || null, onUnauthorized);
        applyResult(result);
      }
    }
    for (const entry of zipEntries) {
      let zipData: Record<string, Uint8Array> | null = null;
      const baseParts = entry.relativePath.split("/").filter(Boolean);
      baseParts.pop();
      const basePath = baseParts.join("/");
      await zipPrompt.prompt({
        label: entry.file.name,
        onImportAsZip: async () => {
          const result = await uploadEntriesToCategory([entry], categoryId || null, onUnauthorized);
          applyResult(result);
        },
        loadEntries: async () => {
          const result = await readZipEntries(entry.file);
          zipData = result.data;
          return result.entries;
        },
        onImportSelected: async (selectedPaths: string[]) => {
          if (!zipData) {
            const result = await readZipEntries(entry.file);
            zipData = result.data;
          }
          const unzipEntries = buildUploadEntriesFromZip(zipData || {}, selectedPaths, basePath);
          const result = await uploadEntriesToCategory(unzipEntries, categoryId || null, onUnauthorized);
          applyResult(result);
        },
      });
    }
    if (batched) {
      await printsApi.uploadSummary(batchPrintIds, batchFailed).catch((err) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else console.error("Upload summary failed", err);
      });
    }
    void refreshNotifications();
    if (uploaded) {
      onUploaded();
      if (uploaded === 1 && prints.length === 1) {
        showToast({ message: t("uploadBar.uploaded", { name: prints[0].title || prints[0].name }) });
        openForEditing(prints[0]);
      } else {
        showToast({ message: t("uploadBar.uploadedMultiple", { count: uploaded }) });
      }
    }
    if (failed.length) {
      alert(t("uploadBar.uploadFailed", { files: failed.join(", ") }));
    }
    setUploading(false);
  };

  const onFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const entries = entriesFromFileList(e.target.files || []);
    if (entries.length) await uploadEntries(entries);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFolderPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const entries = entriesFromFileList(e.target.files || []).filter((entry) => !isSystemFile(entry.file.name));
    if (entries.length) await uploadEntries(entries);
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  const triggerUpload = () => inputRef.current?.click();
  const triggerFolderUpload = () => folderInputRef.current?.click();

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      onChange={onFilePick}
      multiple
      accept={UPLOAD_EXTS.map((ext) => `.${ext}`).join(",")}
      hidden
    />
  );

  // One picker can't take both files and folders: `webkitdirectory` makes it folder-only. React has no
  // typed prop for it, so it's set on the element.
  const folderInput = (
    <input
      ref={(el) => {
        folderInputRef.current = el;
        el?.setAttribute("webkitdirectory", "");
      }}
      type="file"
      onChange={onFolderPick}
      hidden
    />
  );

  /** `profileScope`: which print profiles to import, for a provider with them; more than the link's runs as a job,
   *  and MakerOnline's wait for Thingport Grab. */
  const submitImport = async (
    rawUrl: string,
    captcha?: CaptchaAnswer | null,
    profileScope: MakerworldProfileScope = "url",
  ) => {
    const url = rawUrl.trim();
    if (!url) return;
    setImporting(true);
    try {
      const payload = {
        url,
        category_id: categoryId || undefined,
        ...captcha,
      };

      if (isGrabOnlyList(url)) {
        // Its lists import only through Thingport Grab, on their own pages.
        showToast({ message: t("addMenu.makerworldCollectionBlocked"), severity: "warning" });
        return;
      }

      const model = modelLinkOf(url);
      const list = model ? null : listLinkOf(url);

      if (profileScope !== "url" && model && !filesNeedGrab(model.provider) && hasPrintProfiles(url)) {
        await startProfilesImport(model.provider, { ...payload, scope: profileScope });
        return;
      }

      if (model && filesNeedGrab(model.provider)) {
        // Its files come only through Thingport Grab, on the provider's own pages.
        await importsApi.queueForGrab(model.provider, { ...payload, scope: profileScope });
        showToast({ message: t("uploadBar.makeronlineWaiting") });
        return;
      }

      if (list) {
        const { provider } = list;
        setImporting(false);
        await collectionPrompt.prompt({
          label: url,
          loadEntries: async () => {
            try {
              return await importsApi.listEntries(provider, payload);
            } catch (err) {
              if (err instanceof UnauthorizedError) onUnauthorized?.();
              throw err;
            }
          },
          onImportSelected: async (modelIds: string[]) => {
            try {
              const queued = await startListImport(provider, { ...payload, model_ids: modelIds });
              if (queued) showToast({ message: t("uploadBar.makeronlineListWaiting", { count: queued.queued }) });
            } catch (err) {
              if (err instanceof UnauthorizedError) {
                onUnauthorized?.();
                return;
              }
              throw err;
            }
          },
        });
        return;
      }

      // A model whose link may be a zip of its raw files imports as any other link does, asking what to do with a zip;
      // the backend splits the rest into plates itself.
      if (model && !mayBeRawFilesZip(model.provider)) {
        await startSingleImport(payload);
        return;
      }

      const inspect = await importsApi.inspectLink(payload);
      if (!inspect.is_zip) {
        await startSingleImport(payload);
        return;
      }
      setImporting(false);
      await zipPrompt.prompt({
        label: inspect.filename,
        onImportAsZip: async () => {
          try {
            await startSingleImport(payload);
          } catch (err) {
            if (err instanceof UnauthorizedError) {
              onUnauthorized?.();
              return;
            }
            throw err;
          }
        },
        loadEntries: async () => {
          try {
            const result = await importsApi.listZipEntries(payload);
            return result.entries;
          } catch (err) {
            if (err instanceof UnauthorizedError) {
              onUnauthorized?.();
            }
            throw err;
          }
        },
        onImportSelected: async (entries: string[]) => {
          try {
            await startZipImport({ ...payload, entries });
          } catch (err) {
            if (err instanceof UnauthorizedError) {
              onUnauthorized?.();
              return;
            }
            throw err;
          }
        },
      });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error("Import failed for", url, err);
      const message = err instanceof Error ? err.message : t("uploadBar.importFailed");
      alert(message);
    } finally {
      setImporting(false);
      // The import's notification is already written; show it on the bell now, not at the next poll.
      void refreshNotifications();
    }
  };

  /** Several pasted links run as one queue job, with per-link retries for whatever fails. */
  const submitImportMany = async (
    urls: string[],
    captcha?: CaptchaAnswer | null,
    profileScope: MakerworldProfileScope = "url",
  ) => {
    if (!urls.length) return;
    setImporting(true);
    try {
      await startLinksImport({
        urls,
        scope: profileScope,
        category_id: categoryId || undefined,
        ...captcha,
      });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error("Import failed for", urls, err);
      alert(err instanceof Error ? err.message : t("uploadBar.importFailed"));
    } finally {
      setImporting(false);
    }
  };

  return {
    fileInput,
    folderInput,
    uploading,
    importing,
    isBusy,
    triggerUpload,
    triggerFolderUpload,
    submitImport,
    submitImportMany,
    modals: (
      <>
        {zipPrompt.modal}
        {collectionPrompt.modal}
        {importModePrompt.modal}
      </>
    ),
  };
}
