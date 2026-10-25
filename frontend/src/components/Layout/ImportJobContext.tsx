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
  jobs: ImportJob[];
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
  retryJob: (jobId: string) => Promise<void>;
  dismissJob: (jobId: string) => void;
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
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const tracked = useRef(new Map<string, { timer: number | null; polling: boolean; running: boolean }>());
  const mounted = useRef(true);
  const onJobCompletedRef = useRef(onJobCompleted);
  onJobCompletedRef.current = onJobCompleted;

  const removeJob = useCallback((jobId: string) => {
    const entry = tracked.current.get(jobId);
    if (entry?.timer != null) window.clearInterval(entry.timer);
    tracked.current.delete(jobId);
    setJobs((current) => current.filter((job) => job.id !== jobId));
  }, []);

  const followJob = useCallback(
    async (jobId: string, taskSource: string | null = null, recovered?: ImportJob) => {
      if (!mounted.current || tracked.current.has(jobId)) return;
      const entry = { timer: null as number | null, polling: false, running: false };
      tracked.current.set(jobId, entry);
      const update = async (initial?: ImportJob) => {
        if (entry.polling) return;
        entry.polling = true;
        try {
          const job =
            initial ??
            (taskSource !== null
              ? await importsApi.getImportTaskJob(jobId, taskSource)
              : await importsApi.getImportJob(jobId));
          if (!mounted.current || tracked.current.get(jobId) !== entry) return;
          const running = job.status === "RUNNING" || job.status === "QUEUED";
          entry.running = running;
          if (!running && entry.timer !== null) window.clearInterval(entry.timer);
          if (job.status === "PAUSED") {
            removeJob(jobId);
            return;
          }
          if (running || job.failed_count > 0 || job.status === "ERROR") {
            setJobs((current) =>
              current.some((item) => item.id === jobId)
                ? current.map((item) => (item.id === jobId ? job : item))
                : [...current, job],
            );
          } else {
            removeJob(jobId);
          }
          if (!running) {
            onJobCompletedRef.current?.();
            if (
              job.status === "DONE" &&
              job.failed_count === 0 &&
              !Array.from(tracked.current.values()).some((other) => other.running)
            ) {
              if (job.result_print_id) navigate(`/models/${job.result_print_id}`);
              else if (job.imported + job.already_in_library > 1) navigate("/models");
            }
          }
        } catch (err) {
          if (!mounted.current || tracked.current.get(jobId) !== entry) return;
          removeJob(jobId);
          if (err instanceof UnauthorizedError) onUnauthorized?.();
          // Initial follow failures must reach the submitting dialog.
          if (entry.timer === null) throw err;
        } finally {
          entry.polling = false;
        }
      };
      await update(recovered);
      if (tracked.current.get(jobId) === entry && entry.running) {
        entry.timer = window.setInterval(() => {
          void update();
        }, POLL_INTERVAL_MS);
      }
    },
    [navigate, onUnauthorized, removeJob],
  );

  useEffect(() => {
    mounted.current = true;
    const entries = tracked.current;
    void importsApi
      .getActiveImportJobs()
      .then((active) => {
        if (!mounted.current) return;
        for (const job of active) void followJob(job.id, null, job);
      })
      .catch((err) => {
        if (mounted.current && err instanceof UnauthorizedError) onUnauthorized?.();
      });
    return () => {
      mounted.current = false;
      for (const entry of entries.values()) {
        if (entry.timer !== null) window.clearInterval(entry.timer);
      }
      entries.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSingleImport = useCallback(
    async (payload: StartSingleImportPayload) => {
      const started = await importsApi.queueFromLink(payload);
      return followJob(started.job_id ?? started.task_id, started.job_id ? null : payload.url);
    },
    [followJob],
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

  const retryJob = useCallback(
    async (jobId: string) => {
      const started = await importsApi.retryImportJob(jobId);
      removeJob(jobId);
      await followJob(started.job_id);
    },
    [followJob, removeJob],
  );

  const value = useMemo(
    () => ({
      jobs,
      startSingleImport,
      startZipImport,
      startListImport,
      startProfilesImport,
      startLinksImport,
      retryJob,
      dismissJob: removeJob,
    }),
    [
      jobs,
      startSingleImport,
      startZipImport,
      startListImport,
      startProfilesImport,
      startLinksImport,
      retryJob,
      removeJob,
    ],
  );

  return <ImportJobContext.Provider value={value}>{children}</ImportJobContext.Provider>;
}

export function useImportJob() {
  const ctx = useContext(ImportJobContext);
  if (!ctx) throw new Error("useImportJob must be used within an ImportJobProvider");
  return ctx;
}
