import type { TFunction } from "i18next";
import type { CaptchaAnswer } from "../../api/captcha";
import { UnauthorizedError } from "../../api/client";
import { importsApi, type MakerworldProfileScope, type QueueSubmitAnswer } from "../../api/imports";
import {
  filesNeedGrab,
  hasPrintProfiles,
  isGrabOnlyList,
  listLinkOf,
  modelLinkOf,
} from "../../utils/importLinkDetection";
import type { QueueActions } from "../importQueue/queueStore";
import type { ToastOptions } from "../ToastProvider";
import type { CollectionPromptConfig } from "./CollectionImportModal";
import type { ZipPromptConfig } from "./ZipImportModal";

// Long enough to reach its Try again button.
const FAILURE_TOAST_MS = 8000;

/** Inspections can finish together, but each picker holds only one pending choice, so prompts take turns. */
export function createPromptChain() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(prompt: () => Promise<T>): Promise<T> => {
    const next = tail.then(prompt);
    tail = next.catch(() => undefined);
    return next;
  };
}

type ImportedPrint = Extract<QueueSubmitAnswer, { kind: "print" }>["print"];

export type ImportSubmitDeps = {
  queue: Pick<QueueActions, "submitLink" | "submitLinks" | "submitZip" | "submitList" | "submitProfiles">;
  categoryId?: string | null;
  t: TFunction;
  toast: (options: ToastOptions) => void;
  showZipPrompt: (config: ZipPromptConfig) => Promise<void>;
  showCollectionPrompt: (config: CollectionPromptConfig) => Promise<void>;
  /** It was imported before the answer came: a request that has to run now, or a backend older than the queue. */
  onImported: (print: ImportedPrint) => void;
  onUnauthorized?: () => void;
  /** Back to the import dialog, with what was in it. */
  onTryAgain: (links: string, scope: MakerworldProfileScope) => void;
  /** A single link's request ended, one way or another. */
  onSettled: () => void;
};

/** What the import dialog's links go through, on their way to the queue. Saved sign-ins stay on the server, which fills
 *  them in: a request carrying one has to run now, and would skip the line. */
export function createImportSubmit({
  queue,
  categoryId,
  t,
  toast,
  showZipPrompt,
  showCollectionPrompt,
  onImported,
  onUnauthorized,
  onTryAgain,
  onSettled,
}: ImportSubmitDeps) {
  /** A job's toast is the queue's, which knows its place in line. */
  const announce = (answer: QueueSubmitAnswer) => {
    if (answer.kind === "grab") toast({ message: t("uploadBar.makeronlineListWaiting", { count: answer.queued }) });
    if (answer.kind === "print") onImported(answer.print);
  };

  /** The dialog has closed by now, so the toast offers it back. */
  const reportFailure = (err: unknown, links: string, scope: MakerworldProfileScope) => {
    if (err instanceof UnauthorizedError) {
      onUnauthorized?.();
      return;
    }
    console.error("Import failed for", links, err);
    toast({
      message: err instanceof Error && err.message ? err.message : t("uploadBar.importFailed"),
      severity: "error",
      action: { label: t("importQueue.toast.tryAgain"), onClick: () => onTryAgain(links, scope) },
      autoHideMs: FAILURE_TOAST_MS,
    });
  };

  /** For what a prompt reads to fill itself: it shows the failure, 401 or not. */
  const notingSignOut = async <T>(read: () => Promise<T>): Promise<T> => {
    try {
      return await read();
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      throw err;
    }
  };

  /** For a prompt's own import: it shows a failure and stays open for another go, unless signed out. */
  const submittingFromPrompt = async (submit: () => Promise<QueueSubmitAnswer>) => {
    try {
      announce(await submit());
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      throw err;
    }
  };

  /** `profileScope`: which print profiles to import, for a provider with them; more than the link's runs as a job,
   *  and MakerOnline's wait for Thingport Grab. */
  const submitImport = async (
    rawUrl: string,
    captcha?: CaptchaAnswer | null,
    profileScope: MakerworldProfileScope = "url",
  ) => {
    const url = rawUrl.trim();
    if (!url) return;
    try {
      const payload = { url, category_id: categoryId || undefined, ...captcha };

      if (isGrabOnlyList(url)) {
        // Its lists import only through Thingport Grab, on their own pages.
        toast({ message: t("addMenu.makerworldCollectionBlocked"), severity: "warning" });
        return;
      }

      const model = modelLinkOf(url);
      const list = model ? null : listLinkOf(url);

      if (profileScope !== "url" && model && !filesNeedGrab(model.provider) && hasPrintProfiles(url)) {
        announce(await queue.submitProfiles(model.provider, { ...payload, scope: profileScope }));
        return;
      }

      if (model && filesNeedGrab(model.provider)) {
        // Its files come only through Thingport Grab, on the provider's own pages.
        await importsApi.queueForGrab(model.provider, { ...payload, scope: profileScope });
        toast({ message: t("uploadBar.makeronlineWaiting") });
        return;
      }

      if (list) {
        const { provider } = list;
        // What the job is called while it waits, before anything has read the list again.
        let collectionTitle: string | undefined;
        await showCollectionPrompt({
          label: url,
          loadEntries: () =>
            notingSignOut(async () => {
              const result = await importsApi.listEntries(provider, payload);
              collectionTitle = result.title ?? undefined;
              return result;
            }),
          onImportSelected: (modelIds) =>
            submittingFromPrompt(() =>
              queue.submitList(provider, { ...payload, model_ids: modelIds, collection_title: collectionTitle }),
            ),
        });
        return;
      }

      // A model goes straight in line, and the backend splits a zip of its files into plates when its turn comes. Looking
      // first would reach the provider now, at every paste, beside whatever the line is importing from it.
      if (model) {
        announce(await queue.submitLink(payload));
        return;
      }

      const inspect = await importsApi.inspectLink(payload);
      if (!inspect.is_zip) {
        announce(await queue.submitLink(payload));
        return;
      }
      await showZipPrompt({
        label: inspect.filename,
        onImportAsZip: () => submittingFromPrompt(() => queue.submitLink(payload)),
        loadEntries: () => notingSignOut(async () => (await importsApi.listZipEntries(payload)).entries),
        onImportSelected: (entries) =>
          submittingFromPrompt(() => queue.submitZip({ ...payload, entries, filename: inspect.filename })),
      });
    } catch (err) {
      reportFailure(err, url, profileScope);
    } finally {
      onSettled();
    }
  };

  /** Several pasted links run as one job, with per-link retries for whatever fails. */
  const submitImportMany = async (
    urls: string[],
    captcha?: CaptchaAnswer | null,
    profileScope: MakerworldProfileScope = "url",
  ) => {
    if (!urls.length) return;
    try {
      announce(
        await queue.submitLinks({ urls, scope: profileScope, category_id: categoryId || undefined, ...captcha }),
      );
    } catch (err) {
      reportFailure(err, urls.join("\n"), profileScope);
    }
  };

  return { submitImport, submitImportMany };
}
