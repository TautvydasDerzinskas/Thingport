import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useNavigate } from "react-router-dom";
import { importsApi, type ImportJob } from "../../api/imports";
import { UnauthorizedError } from "../../api/client";
import type { ProviderId } from "../../providers/index.generated";

type StartZipImportPayload = Parameters<typeof importsApi.zipFromLink>[0];
type StartListImportPayload = Parameters<typeof importsApi.startList>[1];
type StartProfilesImportPayload = Parameters<typeof importsApi.startProfiles>[1];
type StartLinksImportPayload = Parameters<typeof importsApi.fromLinks>[0];
type StartSingleImportPayload = Parameters<typeof importsApi.queueFromLink>[0];

type ImportJobContextValue = {
  /** The job currently shown in the progress bar, including finished failures. */
  activeJob: ImportJob | null;
  isImporting: boolean;
  startSingleImport: (payload: StartSingleImportPayload) => Promise<void>;
  startZipImport: (payload: StartZipImportPayload) => Promise<void>;
  /** The models queued for Thingport Grab where the provider's files come through it, else null: a job runs. */
  startListImport: (
    provider: ProviderId,
    payload: StartListImportPayload,
  ) => Promise<{ queued: number; collection_id: string } | null>;
  startProfilesImport: (provider: ProviderId, payload: StartProfilesImportPayload) => Promise<void>;
  startLinksImport: (payload: StartLinksImportPayload) => Promise<void>;
  /** Reruns the links that failed on the finished job shown in the progress bar. */
  retryJob: () => Promise<void>;
  dismissJob: () => void;
};

const ImportJobContext = createContext<ImportJobContextValue | null>(null);

const POLL_INTERVAL_MS = 1000;

export function ImportJobProvider({
  onUnauthorized,
  onJobCompleted,
  children,
}: {
  onUnauthorized?: () => void;
  onJobCompleted?: () => void;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const [activeJob, setActiveJob] = useState<ImportJob | null>(null);
  const taskSourceRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const onJobCompletedRef = useRef(onJobCompleted);
  onJobCompletedRef.current = onJobCompleted;

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollJob = useCallback(
    async (jobId: string) => {
      try {
        const job =
          taskSourceRef.current !== null
            ? await importsApi.getImportTaskJob(jobId, taskSourceRef.current)
            : await importsApi.getImportJob(jobId);
        if (job.status === "RUNNING" || job.status === "QUEUED") {
          setActiveJob(job);
          return;
        }
        stopPolling();
        // Paused from the admin import queue: nothing finished, so don't navigate anywhere.
        if (job.status === "PAUSED") {
          setActiveJob(null);
          return;
        }
        onJobCompletedRef.current?.();
        // Keep failures visible until dismissed; only LINKS currently supports retrying failed items.
        if (job.failed_count > 0 || job.status === "ERROR") {
          setActiveJob(job);
          return;
        }
        setActiveJob(null);
        // One resulting print opens its details page; more go to the models grid; none stays put.
        if (job.status === "DONE") {
          if (job.result_print_id) {
            navigate(`/models/${job.result_print_id}`);
          } else if (job.imported + job.already_in_library > 1) {
            // Dedup hits count as results too.
            navigate("/models");
          }
        }
      } catch (err) {
        stopPolling();
        setActiveJob(null);
        if (err instanceof UnauthorizedError) onUnauthorized?.();
      }
    },
    [onUnauthorized, stopPolling, navigate],
  );

  const startPolling = useCallback(
    (jobId: string) => {
      stopPolling();
      pollRef.current = window.setInterval(() => {
        void pollJob(jobId);
      }, POLL_INTERVAL_MS);
    },
    [pollJob, stopPolling],
  );

  useEffect(() => {
    (async () => {
      try {
        const job = await importsApi.getActiveImportJob();
        if (job && (job.status === "RUNNING" || job.status === "QUEUED")) {
          setActiveJob(job);
          startPolling(job.id);
        }
      } catch (err) {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
      }
    })();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const followJob = useCallback(
    async (jobId: string) => {
      taskSourceRef.current = null;
      setActiveJob(await importsApi.getImportJob(jobId));
      startPolling(jobId);
    },
    [startPolling],
  );

  const startSingleImport = useCallback(
    async (payload: StartSingleImportPayload) => {
      const started = await importsApi.queueFromLink(payload);
      if (started.job_id) return followJob(started.job_id);
      stopPolling();
      taskSourceRef.current = payload.url;
      setActiveJob(await importsApi.getImportTaskJob(started.task_id, payload.url));
      startPolling(started.task_id);
    },
    [followJob, startPolling, stopPolling],
  );

  const startZipImport = useCallback(
    async (payload: StartZipImportPayload) => followJob((await importsApi.zipFromLink(payload)).job_id),
    [followJob],
  );

  const startListImport = useCallback(
    async (provider: ProviderId, payload: StartListImportPayload) => {
      const started = await importsApi.startList(provider, payload);
      if ("queued" in started) return started;
      await followJob(started.job_id);
      return null;
    },
    [followJob],
  );

  const startProfilesImport = useCallback(
    async (provider: ProviderId, payload: StartProfilesImportPayload) =>
      followJob((await importsApi.startProfiles(provider, payload)).job_id),
    [followJob],
  );

  const startLinksImport = useCallback(
    async (payload: StartLinksImportPayload) => followJob((await importsApi.fromLinks(payload)).job_id),
    [followJob],
  );

  const retryJob = useCallback(async () => {
    if (!activeJob) return;
    await followJob((await importsApi.retryImportJob(activeJob.id)).job_id);
  }, [activeJob, followJob]);

  const dismissJob = useCallback(() => {
    stopPolling();
    setActiveJob(null);
  }, [stopPolling]);

  const value = useMemo(
    () => ({
      activeJob,
      isImporting: activeJob !== null,
      startSingleImport,
      startZipImport,
      startListImport,
      startProfilesImport,
      startLinksImport,
      retryJob,
      dismissJob,
    }),
    [
      activeJob,
      startSingleImport,
      startZipImport,
      startListImport,
      startProfilesImport,
      startLinksImport,
      retryJob,
      dismissJob,
    ],
  );

  return <ImportJobContext.Provider value={value}>{children}</ImportJobContext.Provider>;
}

export function useImportJob() {
  const ctx = useContext(ImportJobContext);
  if (!ctx) throw new Error("useImportJob must be used within an ImportJobProvider");
  return ctx;
}
