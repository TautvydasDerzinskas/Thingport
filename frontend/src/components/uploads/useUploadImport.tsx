import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { UnauthorizedError } from "../../api/client";
import type { ImportOutcome, MakerworldProfileScope } from "../../api/imports";
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
import { useImportQueue } from "../importQueue/ImportQueueContext";
import { createImportSubmit, createPromptChain } from "./importSubmit";
import { UPLOAD_EXTS } from "../../constants/fileTypes";
import { useToast } from "../ToastProvider";

// A folder pick always prefixes relativePath with the folder name.
function isFlatFileSet(entries: { file: File; relativePath: string }[]) {
  return entries.length > 1 && entries.every((entry) => entry.relativePath === entry.file.name);
}

type Props = {
  onUploaded: () => void;
  categoryId?: string | null;
  onUnauthorized?: () => void;
  /** A submitted link failed, and its toast offers the import dialog back, with what was in it. */
  onTryAgain: (links: string, scope: MakerworldProfileScope) => void;
};

/** `modals` must be rendered by the caller alongside the menu. */
export function useUploadImport({ onUploaded, categoryId, onUnauthorized, onTryAgain }: Props) {
  const { t } = useTranslation("app");
  const showToast = useToast();
  const { refresh: refreshNotifications } = useNotifications();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  // Links on their way: the dialog has closed, and nothing else shows it until the server answers.
  const [submitting, setSubmitting] = useState(0);
  const zipPrompt = useZipImportPrompt();
  const collectionPrompt = useCollectionImportPrompt();
  const importModePrompt = useImportModePrompt();
  const showPrompt = useMemo(() => createPromptChain(), []);
  const queue = useImportQueue();
  const isBusy = uploading || zipPrompt.isOpen || collectionPrompt.isOpen || importModePrompt.isOpen;

  // A plain upload has no metadata yet, so open it straight in edit mode.
  const openForEditing = (print: Print) => {
    navigate(`/models/${print.id}?edit=${print.id}`);
  };

  // Only what was imported before the server answered: anything that waits its turn doesn't jump.
  const openForViewing = (print: Print) => {
    navigate(`/models/${print.id}`);
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
        await showPrompt(() =>
          importModePrompt.prompt({
            label: normalEntries.map((entry) => entry.file.name).join(", "),
            count: normalEntries.length,
            onChoose: async (mode: ImportMode) => {
              if (mode === "multiplate") {
                applyResult(await uploadFlatAsMultiplate(normalEntries.map((entry) => entry.file)));
              } else {
                applyResult(await uploadEntriesToCategory(normalEntries, categoryId || null, onUnauthorized));
              }
            },
          }),
        );
      } else if (hasModelFolders(normalEntries)) {
        // Libraries often keep one model per folder, split into several files with its photos alongside.
        const roots = [...new Set(normalEntries.map((entry) => entry.relativePath.split("/")[0]))];
        await showPrompt(() =>
          importModePrompt.prompt({
            label: roots.join(", "),
            count: normalEntries.length,
            variant: "folders",
            onChoose: async (mode: ImportMode) => {
              const upload = mode === "multiplate" ? uploadFoldersAsModels : uploadEntriesToCategory;
              applyResult(await upload(normalEntries, categoryId || null, onUnauthorized));
            },
          }),
        );
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
      await showPrompt(() =>
        zipPrompt.prompt({
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
        }),
      );
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

  const showImportedToast = (imported: Print & { import_outcome?: ImportOutcome }) => {
    const name = imported.title || imported.name;
    const key =
      imported.import_outcome === "profile_added"
        ? "uploadBar.profileAdded"
        : imported.import_outcome === "already_imported"
          ? "uploadBar.alreadyInLibrary"
          : "uploadBar.imported";
    showToast({ message: t(key, { name }) });
  };

  const links = createImportSubmit({
    queue,
    categoryId,
    t,
    toast: showToast,
    showZipPrompt: (config) => showPrompt(() => zipPrompt.prompt(config)),
    showCollectionPrompt: (config) => showPrompt(() => collectionPrompt.prompt(config)),
    onImported: (imported) => {
      showImportedToast(imported);
      onUploaded();
      openForViewing(imported);
    },
    onUnauthorized,
    onTryAgain,
    // An import that ran at once has written its notification: show it on the bell now, not at the next poll.
    onSettled: () => void refreshNotifications(),
  });

  const tracked =
    <Args extends unknown[]>(submit: (...args: Args) => Promise<void>) =>
    async (...args: Args) => {
      setSubmitting((count) => count + 1);
      try {
        await submit(...args);
      } finally {
        setSubmitting((count) => count - 1);
      }
    };

  return {
    fileInput,
    folderInput,
    uploading,
    submitting: submitting > 0,
    isBusy,
    triggerUpload,
    triggerFolderUpload,
    submitImport: tracked(links.submitImport),
    submitImportMany: tracked(links.submitImportMany),
    modals: (
      <>
        {zipPrompt.modal}
        {collectionPrompt.modal}
        {importModePrompt.modal}
      </>
    ),
  };
}
