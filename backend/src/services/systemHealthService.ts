import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import nodemailer from "nodemailer";
import type { Prisma } from "@prisma/client";
import { cgroupMemoryLimitBytes, MODEL_PREVIEW_MAX_MEMORY_MB, STORAGE } from "../config";
import { prisma } from "../db";
import { listAiProviderModels } from "./aiCategorizationService";
import { resolveAiConnection } from "./aiConnectionService";
import { testFlaresolverr } from "./flaresolverr";
import { getFlaresolverrUrl, getSmtpSettings, getThingiverseAccessToken } from "./settingsService";
import { checkThingiverseAccessToken } from "./thingiverseApi";
import { isProviderEnabled } from "./providerSettingsService";

// Administration's System Health: each component Thingport relies on, tested only when an admin asks. Results are
// kept, with when each was taken, so the page shows the last ones without testing anything on its own.

/** By importance: what everything needs first, what's optional last. */
export const HEALTH_COMPONENTS = [
  "database",
  "storage",
  "memory",
  "flaresolverr",
  "thingiverse",
  "ai",
  "smtp",
] as const;
export type HealthComponent = (typeof HEALTH_COMPONENTS)[number];

export type HealthStatus = "ok" | "warning" | "error" | "not_configured";

export type HealthResult = {
  component: HealthComponent;
  status: HealthStatus;
  /** What was found, for the page to explain and say how to fix: "unreachable", "low_space"... */
  code: string;
  /** The underlying error, as the component gave it. */
  detail: string | null;
  facts: Record<string, string | number | null>;
  latency_ms: number | null;
  checked_at: string;
};

export type HealthReport = {
  components: { component: HealthComponent; result: HealthResult | null }[];
  /** When every component was last tested together. */
  full_checked_at: string | null;
};

const SETTING_KEY = "system_health";
// Any number, as long as only the report's writers take it.
const REPORT_LOCK = 74_210_303;
const CHECK_TIMEOUT_MS = 20_000;
const LOW_DISK_BYTES = 2 * 1024 ** 3;
const LOW_MEMORY_BYTES = 256 * 1024 ** 2;

type Found = Omit<HealthResult, "component" | "checked_at" | "latency_ms"> & { latency_ms?: number | null };

const found = (
  status: HealthStatus,
  code: string,
  facts: Found["facts"] = {},
  detail: string | null = null,
): Found => ({
  status,
  code,
  facts,
  detail,
});

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function checkDatabase(): Promise<Found> {
  const start = Date.now();
  try {
    const [row] = await prisma.$queryRaw<{ version: string }[]>`SELECT version() AS version`;
    // "PostgreSQL 16.4 on x86_64-pc-linux-musl, ..." -> "PostgreSQL 16.4"
    const version = row?.version.split(" on ")[0] ?? null;
    return { ...found("ok", "ok", { version }), latency_ms: Date.now() - start };
  } catch (err) {
    return found("error", "unreachable", {}, message(err));
  }
}

async function checkStorage(): Promise<Found> {
  // A real write, as imports and uploads make: a read-only or full volume shows up here.
  const probe = path.join(STORAGE, `.health-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(probe, "ok");
    await fs.rm(probe, { force: true });
  } catch (err) {
    return found("error", "not_writable", { path: STORAGE }, message(err));
  }
  try {
    const stats = await fs.statfs(STORAGE);
    const free = stats.bavail * stats.bsize;
    const total = stats.blocks * stats.bsize;
    const facts = { path: STORAGE, free_bytes: free, total_bytes: total };
    return free < LOW_DISK_BYTES || free < total * 0.05
      ? found("warning", "low_space", facts)
      : found("ok", "ok", facts);
  } catch {
    return found("ok", "ok", { path: STORAGE });
  }
}

async function cgroupMemoryUsedBytes(): Promise<number | null> {
  for (const file of ["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes"]) {
    try {
      const value = Number((await fs.readFile(file, "utf8")).trim());
      if (Number.isFinite(value) && value > 0) return value;
    } catch {
      // Not in a container, or another cgroup version.
    }
  }
  return null;
}

async function checkMemory(): Promise<Found> {
  const limit = cgroupMemoryLimitBytes();
  const used = limit ? await cgroupMemoryUsedBytes() : null;
  // In a container its own limit is what runs out, whatever the host has left.
  const total = limit ?? os.totalmem();
  const available = limit && used !== null ? Math.max(0, limit - used) : os.freemem();
  const facts = {
    total_bytes: total,
    available_bytes: available,
    process_bytes: process.memoryUsage().rss,
    container_limited: limit ? 1 : 0,
    preview_limit_mb: MODEL_PREVIEW_MAX_MEMORY_MB,
  };
  return available < LOW_MEMORY_BYTES || available < total * 0.1
    ? found("warning", "low_memory", facts)
    : found("ok", "ok", facts);
}

async function checkFlaresolverr(): Promise<Found> {
  const url = await getFlaresolverrUrl();
  if (!url) return found("not_configured", "not_configured");
  const result = await testFlaresolverr(url);
  return result.ok
    ? { ...found("ok", "ok", { url, version: result.version }), latency_ms: result.latencyMs }
    : found("error", "unreachable", { url }, result.error);
}

async function checkThingiverse(): Promise<Found> {
  if (!(await isProviderEnabled("thingiverse"))) return found("not_configured", "disabled");
  const token = await getThingiverseAccessToken();
  if (!token) return found("not_configured", "not_configured");
  const start = Date.now();
  const result = await checkThingiverseAccessToken(token);
  const latency_ms = Date.now() - start;
  if (result === "ok") return { ...found("ok", "ok"), latency_ms };
  if (result === "rejected") return found("error", "token_rejected");
  // Cloudflare's challenge says nothing about the token; FlareSolverr is the way past it.
  if (result === "blocked") return found("warning", "blocked", { flaresolverr: (await getFlaresolverrUrl()) ? 1 : 0 });
  return found("error", "unreachable");
}

async function checkAi(): Promise<Found> {
  const connection = await resolveAiConnection(null);
  if (!connection) return found("not_configured", "not_configured");
  const facts = { host: hostOf(connection.baseUrl), model: connection.model };
  const start = Date.now();
  // The model list, not a test prompt: a prompt takes minutes on a slow CPU, the list comes back at once.
  const result = await listAiProviderModels({ baseUrl: connection.baseUrl, apiKey: connection.apiKey });
  const latency_ms = Date.now() - start;
  if (!result.ok) return found("error", "unreachable", facts, result.error);
  // Some providers list nothing they'd still answer for, so a missing model is a warning, not a failure.
  if (result.models.length && !result.models.includes(connection.model)) {
    return { ...found("warning", "model_missing", facts), latency_ms };
  }
  return { ...found("ok", "ok", facts), latency_ms };
}

async function checkSmtp(): Promise<Found> {
  const smtp = await getSmtpSettings();
  if (!smtp.host) return found("not_configured", "not_configured");
  const facts = { host: smtp.host, port: smtp.port };
  const start = Date.now();
  try {
    // Connects and logs in, without sending anything.
    await nodemailer
      .createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? undefined } : undefined,
        connectionTimeout: CHECK_TIMEOUT_MS,
      })
      .verify();
    return { ...found("ok", "ok", facts), latency_ms: Date.now() - start };
  } catch (err) {
    return found("error", "unreachable", facts, message(err));
  }
}

const CHECKS: Record<HealthComponent, () => Promise<Found>> = {
  database: checkDatabase,
  storage: checkStorage,
  memory: checkMemory,
  flaresolverr: checkFlaresolverr,
  thingiverse: checkThingiverse,
  ai: checkAi,
  smtp: checkSmtp,
};

async function runCheck(component: HealthComponent): Promise<HealthResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Found>((resolve) => {
    timer = setTimeout(
      () => resolve(found("error", "timeout", {}, `No answer within ${CHECK_TIMEOUT_MS / 1000}s`)),
      CHECK_TIMEOUT_MS,
    );
  });
  try {
    const result = await Promise.race([
      CHECKS[component]().catch((err: unknown) => found("error", "failed", {}, message(err))),
      timeout,
    ]);
    return { latency_ms: null, ...result, component, checked_at: new Date().toISOString() };
  } finally {
    clearTimeout(timer);
  }
}

type Stored = { results: Partial<Record<HealthComponent, HealthResult>>; full_checked_at: string | null };

async function readStored(db: Prisma.TransactionClient = prisma): Promise<Stored> {
  const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
  const value = row?.value as Partial<Stored> | undefined;
  return { results: value?.results ?? {}, full_checked_at: value?.full_checked_at ?? null };
}

function report(stored: Stored): HealthReport {
  return {
    components: HEALTH_COMPONENTS.map((component) => ({ component, result: stored.results[component] ?? null })),
    full_checked_at: stored.full_checked_at,
  };
}

export async function getHealthReport(): Promise<HealthReport> {
  return report(await readStored());
}

/** Tests one component, or all of them at once when none is named, and keeps the results. */
export async function testHealth(component?: HealthComponent): Promise<HealthReport> {
  const components = component ? [component] : [...HEALTH_COMPONENTS];
  // Tested outside the lock: checks take seconds, the merge below a moment.
  const results = await Promise.all(components.map(runCheck));
  const finishedAt = new Date().toISOString();
  // Tests from two admins, or a single one during a full test, would each read the report before the other wrote
  // it back and drop the other's results. Taken in turn, each merges into what the last one saved; a result only
  // replaces an older one, so a slow full test can't overwrite a newer single test.
  const stored = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REPORT_LOCK})`;
    const current = await readStored(tx);
    for (const result of results) {
      const kept = current.results[result.component];
      if (!kept || kept.checked_at <= result.checked_at) current.results[result.component] = result;
    }
    if (!component && (!current.full_checked_at || current.full_checked_at < finishedAt)) {
      current.full_checked_at = finishedAt;
    }
    await tx.setting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: current as unknown as Prisma.InputJsonValue },
      update: { value: current as unknown as Prisma.InputJsonValue },
    });
    return current;
  });
  return report(stored);
}
