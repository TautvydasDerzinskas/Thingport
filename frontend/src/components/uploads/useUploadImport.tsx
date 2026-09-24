import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { UnauthorizedError } from "../../api/client";
import { importsApi, type ImportOutcome } from "../../api/imports";
import { printsApi, type Print } from "../../api/prints";
import { entriesFromFileList, uploadEntriesToCategory } from "../../utils/uploadTree";
import { buildUploadEntriesFromZip, isZipFile, readZipEntries } from "../../utils/zipUtils";
import { useZipImportPrompt } from "./ZipImportModal";
import { useCollectionImportPrompt } from "./CollectionImportModal";
import { useImportModePrompt, type ImportMode } from "./ImportModeModal";
import { useImportJob } from "../Layout/ImportJobContext";
import { useToast } from "../ToastProvider";
import {
  isMakerworldCollectionUrl,
  isPrintablesCollectionUrl,
  isPrintablesModelUrl,
  isThingiverseCollectionUrl,
  isThingiverseLikesUrl,
  isThingiverseThingUrl,
} from "../../utils/importLinkDetection";

// Every dropped/picked entry's relativePath equals its bare filename when the
// selection has no folder structure. A webkitdirectory folder pick always
// prefixes relativePath with the folder name, so this only ever fires for a
// flat multi-file picker selection.
function isFlatFileSet(entries: { file: File; relativePath: string }[]) {
  return entries.length > 1 && entries.every(entry => entry.relativePath === entry.file.name);
}

type Props = {
  onUploaded: () => void;
  categoryId?: string | null;
  makerworldCookie?: string | null;
  onUnauthorized?: () => void;
};

/** Backs the top bar's "+ Add" menu -- Upload opens a hidden file input, Import opens a
 *  paste-a-link dialog. Both funnel into the same zip/multi-plate/collection prompts used
 *  elsewhere in the app, so `modals` must be rendered by the caller alongside the menu. */
export function useUploadImport({ onUploaded, categoryId, makerworldCookie, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const showToast = useToast();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const zipPrompt = useZipImportPrompt();
  const collectionPrompt = useCollectionImportPrompt();
  const importModePrompt = useImportModePrompt();
  const {
    startZipImport,
    startThingiverseLikesImport,
    startThingiverseCollectionImport,
    startPrintablesCollectionImport,
  } = useImportJob();
  const isBusy = uploading || importing || zipPrompt.isOpen || collectionPrompt.isOpen || importModePrompt.isOpen;

  // Sends the user straight into editing a just-uploaded model (per spec: a plain upload has no
  // title/notes/tags/category yet, so drop into edit mode immediately to fill them in) -- reuses
  // the same `?edit=<id>` URL param ModelActionsMenu's own "Edit" menu item drives.
  const openForEditing = (print: Print) => {
    navigate(`/models/${print.id}?edit=${print.id}`);
  };

  // A provider import, by contrast, arrives with real metadata already (title, creator, preview
  // images, ...) -- just open its details page, not the edit form.
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
    const normalEntries = entries.filter(entry => !isZipFile(entry.file.name));
    const zipEntries = entries.filter(entry => isZipFile(entry.file.name));
    let uploaded = 0;
    const failed: string[] = [];
    const prints: Print[] = [];
    const applyResult = (result: { uploaded: number; failed: string[]; prints?: Print[] }) => {
      uploaded += result.uploaded;
      failed.push(...result.failed);
      if (result.prints) prints.push(...result.prints);
    };
    if (normalEntries.length) {
      if (isFlatFileSet(normalEntries)) {
        await importModePrompt.prompt({
          label: normalEntries.map(entry => entry.file.name).join(", "),
          count: normalEntries.length,
          onChoose: async (mode: ImportMode) => {
            if (mode === "multiplate") {
              applyResult(await uploadFlatAsMultiplate(normalEntries.map(entry => entry.file)));
            } else {
              applyResult(await uploadEntriesToCategory(normalEntries, categoryId || null, onUnauthorized));
            }
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

  const triggerUpload = () => inputRef.current?.click();

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      onChange={onFilePick}
      multiple
      accept=".png,.jpg,.jpeg,.webp,.bmp,.gif,.svg,.stl,.step,.stp,.3mf,.obj,.f3d,.lbrn,.lbrn2,.zip"
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

  const submitImport = async (rawUrl: string) => {
    const url = rawUrl.trim();
    if (!url) return;
    setImporting(true);
    try {
      const cookie = (makerworldCookie || "").trim();
      const payload = {
        url,
        category_id: categoryId || undefined,
        makerworld_cookie: cookie || undefined,
      };

      if (isMakerworldCollectionUrl(url)) {
        // MakerWorld collections are no longer importable from this dialog -- only via the
        // Thingport Grab browser extension. AddMenu's own inline warning (driven by the same
        // isMakerworldCollectionUrl check) should already stop the user from reaching this point
        // via the dialog's Import button; this is the same guard for any other caller of
        // submitImport.
        alert(t("addMenu.makerworldCollectionBlocked"));
        return;
      }

      if (isThingiverseLikesUrl(url)) {
        setImporting(false);
        await collectionPrompt.prompt({
          label: url,
          loadEntries: async () => {
            try {
              return await importsApi.listThingiverseLikesEntries(payload);
            } catch (err) {
              if (err instanceof UnauthorizedError) onUnauthorized?.();
              throw err;
            }
          },
          onImportSelected: async (thingIds: string[]) => {
            try {
              await startThingiverseLikesImport({ ...payload, thing_ids: thingIds });
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

      if (isThingiverseCollectionUrl(url)) {
        setImporting(false);
        await collectionPrompt.prompt({
          label: url,
          loadEntries: async () => {
            try {
              return await importsApi.listThingiverseCollectionEntries(payload);
            } catch (err) {
              if (err instanceof UnauthorizedError) onUnauthorized?.();
              throw err;
            }
          },
          onImportSelected: async (thingIds: string[]) => {
            try {
              await startThingiverseCollectionImport({ ...payload, thing_ids: thingIds });
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

      if (isPrintablesCollectionUrl(url)) {
        setImporting(false);
        await collectionPrompt.prompt({
          label: url,
          loadEntries: async () => {
            try {
              return await importsApi.listPrintablesCollectionEntries(payload);
            } catch (err) {
              if (err instanceof UnauthorizedError) onUnauthorized?.();
              throw err;
            }
          },
          onImportSelected: async (modelIds: string[]) => {
            try {
              await startPrintablesCollectionImport({ ...payload, model_ids: modelIds });
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

      if (isThingiverseThingUrl(url) || isPrintablesModelUrl(url)) {
        // Both always resolve to several files; skip straight past the inspect/zip-picker steps
        // -- the backend already splits them into plates automatically.
        const imported = await importsApi.fromLink(payload);
        showImportedToast(imported);
        onUploaded();
        openForViewing(imported);
        return;
      }

      const inspect = await importsApi.inspectLink(payload);
      if (!inspect.is_zip) {
        const imported = await importsApi.fromLink(payload);
        showImportedToast(imported);
        onUploaded();
        openForViewing(imported);
        return;
      }
      setImporting(false);
      await zipPrompt.prompt({
        label: inspect.filename,
        onImportAsZip: async () => {
          try {
            const imported = await importsApi.fromLink(payload);
            showImportedToast(imported);
            onUploaded();
            openForViewing(imported);
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
          // Same deal as the collection branch above: hands off to the background job +
          // global progress bar instead of blocking here.
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
    }
  };

  return {
    fileInput,
    uploading,
    importing,
    isBusy,
    triggerUpload,
    submitImport,
    modals: (
      <>
        {zipPrompt.modal}
        {collectionPrompt.modal}
        {importModePrompt.modal}
      </>
    ),
  };
}
