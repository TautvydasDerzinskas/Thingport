import { authHeaders, readToken } from "../utils/auth";
import { apiBase, UnauthorizedError } from "./client";

/** One of the old instance's people, and who they'd be here. */
export type MigratePerson = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MEMBER";
  owner: boolean;
  models: number;
  /** The account here with the same email, which they're merged into; null for a new account. */
  merge: { id: string; name: string } | null;
};

export type MigrateCounts = {
  people: number;
  models: number;
  files: number;
  collections: number;
  designs: number;
  widgets: number;
  tools: number;
  syncs: number;
  signIns: number;
  settings: number;
  secrets: number;
};

/** What a migration was given, and what its check found once it's ready. */
export type MigratePlan = {
  dump: { name: string; size: number } | null;
  /** The old instance's storage folder here; empty for one copied online. */
  folder: string;
  /** The old instance's address, for one copied online, or Manyfold's. */
  address?: string;
  /** What a Manyfold has, and how many of its models earlier migrations brought. */
  manyfold?: { models: number; collections: number; creators: number; before: number };
  /** The release the old instance last ran; null for one before 1.2.0, which didn't say. */
  version?: string | null;
  changes?: { applied: number; added: number };
  counts?: MigrateCounts;
  people?: MigratePerson[];
  missingFiles?: number;
  toolsNotHere?: { slug: string; name: string }[];
  staysBehind?: Partial<Record<"queued" | "waiting" | "chats" | "partners", number>>;
};

export type MigrateOptions = {
  people: string[];
  collections: boolean;
  studio: boolean;
  widgets: boolean;
  tools: boolean;
  syncs: boolean;
  signIns: boolean;
  settings: boolean;
  secrets: boolean;
};

export type MigrateReport = {
  people: { created: number; merged: number; earlier: number };
  models: {
    brought: number;
    alreadyHere: number;
    earlier: number;
    renamed: number;
    noFiles: number;
    toolModels: number;
    failed: number;
    unfiled: number;
  };
  files: { copied: number; missing: number };
  collections: { brought: number; merged: number };
  designs: number;
  widgets: number;
  tools: number;
  syncs: number;
  signIns: number;
  settings: number;
  secrets: number;
  failures: { kind: string; name: string; error: string }[];
};

export type MigrateStep =
  | "owners"
  | "downloading"
  | "restoring"
  | "checking"
  | "upgrading"
  | "files"
  | "people"
  | "models"
  | "collections"
  | "extras"
  | "filing";

export type MigrateRunError = { code: string; message: string; values?: Record<string, string | number> };

type RunBase = {
  id: string;
  status: "preparing" | "ready" | "running" | "done" | "failed";
  plan: MigratePlan;
  error: MigrateRunError | null;
  /** While it's preparing or running, how far it is. */
  progress: { step: MigrateStep; done: number; total: number } | null;
  /** Failed part-way, with its working copy kept: starting again goes on from what came. */
  can_resume: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

/** Who on Manyfold, by username, each person here's models are; everyone else's go to the admin. */
export type ManyfoldOptions = { owners: { username: string; userId: string }[]; collections: boolean };

export type ManyfoldReport = {
  models: { brought: number; earlier: number; noFiles: number; alreadyHere: number; failed: number };
  files: { copied: number; missing: number };
  collections: { brought: number; merged: number };
  failures: { kind: string; name: string; error: string }[];
};

/** From another Thingport instance, by its dump or online: the admin's choices, and what it did. */
export type ThingportRun = RunBase & {
  source: "thingport" | "thingport-online";
  options: MigrateOptions | null;
  report: MigrateReport | null;
};

/** From Manyfold, whose choices and report are its own. */
export type ManyfoldRun = RunBase & {
  source: "manyfold";
  options: ManyfoldOptions | null;
  report: ManyfoldReport | null;
};

/** A migration: what its options and report hold depends on its source, so read them after checking that. */
export type MigrateRun = ThingportRun | ManyfoldRun;

/** Whether another instance can copy this one now, and when it last did. */
export type ExportToken = { active: boolean; expires_at: string | null; used_at: string | null };

/** The server's reason, by a code the page translates (adminSettings.migrate.errors.<code>). */
export class MigrateApiError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number,
    readonly values: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = "MigrateApiError";
  }
}

async function failure(res: Response, fallback: string): Promise<never> {
  if (res.status === 401) throw new UnauthorizedError();
  let detail = fallback;
  let code: string | null = null;
  let values: Record<string, string | number> = {};
  try {
    const body = (await res.json()) as { detail?: unknown; code?: unknown; values?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) detail = body.detail;
    if (typeof body.code === "string") code = body.code;
    if (body.values && typeof body.values === "object") values = body.values as Record<string, string | number>;
  } catch {
    // Not JSON: a proxy in front of the backend answered.
  }
  throw new MigrateApiError(detail, code ?? (res.status === 413 ? "too_big" : null), res.status, values);
}

async function send<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const res = await fetch(`${apiBase()}/admin/migrate${path}`, {
    ...init,
    headers: authHeaders(init.body ? { "Content-Type": "application/json" } : undefined),
  });
  if (!res.ok) return failure(res, fallback);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const migrateApi = {
  /** The migrations, newest first, and the folder on the server a dump and storage folder are read from. */
  list: (): Promise<{ runs: MigrateRun[]; root: string }> =>
    send("", { method: "GET" }, "Couldn't load the migrations"),

  get: (id: string): Promise<MigrateRun> => send(`/${encodeURIComponent(id)}`, { method: "GET" }, "Couldn't load it"),

  /** From another Thingport instance, with its dump uploaded. `onProgress` gets the share sent, 0 to 1. */
  prepareWithUpload: (file: File, folder: string, onProgress: (sent: number) => void): Promise<ThingportRun> =>
    new Promise((resolve, reject) => {
      const body = new FormData();
      body.append("folder", folder);
      body.append("dump", file, file.name);
      const request = new XMLHttpRequest();
      request.open("POST", `${apiBase()}/admin/migrate/thingport`);
      const token = readToken();
      if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
      request.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      });
      request.addEventListener("error", () => reject(new MigrateApiError("The upload stopped", "upload_failed", 0)));
      request.addEventListener("load", () => {
        const res = new Response(request.responseText || null, { status: request.status });
        if (request.status >= 200 && request.status < 300) resolve(res.json() as Promise<ThingportRun>);
        else failure(res, "Couldn't upload the dump").catch(reject);
      });
      request.send(body);
    }),

  /** From another Thingport instance, with its dump already on the server. */
  prepareWithPath: (dumpPath: string, folder: string): Promise<ThingportRun> =>
    send(
      "/thingport",
      { method: "POST", body: JSON.stringify({ dump_path: dumpPath, folder }) },
      "Couldn't read the dump",
    ),

  /** From another Thingport instance online, with the token its admin made there. */
  prepareOnline: (address: string, token: string): Promise<ThingportRun> =>
    send(
      "/thingport-online",
      { method: "POST", body: JSON.stringify({ address, token }) },
      "Couldn't reach the old instance",
    ),

  /** From Manyfold, with an API key made there: tried at once, and ready to start. */
  prepareManyfold: (address: string, clientId: string, clientSecret: string): Promise<ManyfoldRun> =>
    send(
      "/manyfold",
      { method: "POST", body: JSON.stringify({ address, clientId, clientSecret }) },
      "Couldn't reach Manyfold",
    ),

  /** How many models someone owns there, by their Manyfold username. */
  manyfoldOwner: (id: string, username: string): Promise<{ username: string; models: number }> =>
    send(
      `/${encodeURIComponent(id)}/manyfold-owner`,
      { method: "POST", body: JSON.stringify({ username }) },
      "Couldn't ask Manyfold",
    ),

  startManyfold: (id: string, options: ManyfoldOptions): Promise<ManyfoldRun> =>
    send(
      `/${encodeURIComponent(id)}/start-manyfold`,
      { method: "POST", body: JSON.stringify(options) },
      "Couldn't start it",
    ),

  /** The token that lets another instance copy this one, while there is one. */
  exportToken: (): Promise<ExportToken> => send("/export-token", { method: "GET" }, "Couldn't load the token"),

  /** A new token, replacing any other: its value comes only now. */
  createExportToken: (): Promise<{ token: string; expires_at: string }> =>
    send("/export-token", { method: "POST" }, "Couldn't create a token"),

  revokeExportToken: (): Promise<void> => send("/export-token", { method: "DELETE" }, "Couldn't revoke the token"),

  start: (id: string, options: MigrateOptions): Promise<ThingportRun> =>
    send(`/${encodeURIComponent(id)}/start`, { method: "POST", body: JSON.stringify(options) }, "Couldn't start it"),

  changeFolder: (id: string, folder: string): Promise<ThingportRun> =>
    send(
      `/${encodeURIComponent(id)}/folder`,
      { method: "POST", body: JSON.stringify({ folder }) },
      "Couldn't check it",
    ),

  remove: (id: string): Promise<void> => send(`/${encodeURIComponent(id)}`, { method: "DELETE" }, "Couldn't remove it"),
};
