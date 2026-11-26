import i18next from "i18next";
import { requestAchievementCheck } from "../components/achievements/achievementEvents";
import { authHeaders } from "../utils/auth";
import { apiBase, UnauthorizedError } from "./client";
import type { StudioCommandArgs, StudioCommandName } from "../studio/commands";
import { LIMITS, MAX_PLATES, type StudioDocument } from "../studio/document";

export type StudioDesignSummary = {
  id: string;
  name: string;
  feature_count: number;
  version: number;
  updated_at: string;
};

export type StudioDesign = StudioDesignSummary & {
  document: StudioDocument;
  can_undo: boolean;
  can_redo: boolean;
  undone_source_plate_ids?: string[];
  created_at: string;
};

export type StudioCommandResult = { design: StudioDesign; summary: string; created: string[] };

/** A library model Studio can import, with the 3D files it could take. */
export type StudioLibraryModel = {
  id: string;
  title: string;
  thumb_url: string | null;
  files: { id: string; name: string; size: number }[];
};

/** An AI from Administration > AI, as the prompt's picker shows it. */
/** `vision`: it sees pictures, so a prompt to it can carry some. */
export type StudioAiModel = { id: string; model: string; host: string; vision: boolean; is_default: boolean };
/** A picture a design keeps, for a prompt or for tracing. */
export type StudioPicture = { id: string; width: number; height: number };
/** The AIs an admin offers for the assistant; none while it's off. */
export type StudioAiModels = { enabled: boolean; models: StudioAiModel[] };

/** One tool call the assistant made: what it was, what it did, and whether it worked. */
export type StudioAssistantStep = { tool: string; title: string; summary: string | null; ok: boolean };
export type StudioAssistantOutcome = "done" | "stopped" | "limit" | "failed";
export type StudioAssistantMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** A prompt's pictures. */
  pictures: StudioPicture[];
  steps: StudioAssistantStep[];
  outcome: StudioAssistantOutcome | null;
  error: string | null;
  model: string | null;
  created_at: string;
};
export type StudioAssistantRun = {
  status: "running" | StudioAssistantOutcome;
  steps: StudioAssistantStep[];
  model: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};
/** The conversation about a design, and the run going on or just finished. */
export type StudioAssistantThread = { messages: StudioAssistantMessage[]; run: StudioAssistantRun | null };

/** What the server said no to, in its words: a command it couldn't carry out says why. */
export class StudioError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

const importErrors = new Map([
  ["studio_import_archive_limit", "archiveLimit"],
  ["studio_import_no_plates", "noPlates"],
  ["studio_import_plate_limit", "plateLimit"],
  ["studio_import_body_limit", "bodyLimit"],
  ["studio_import_missing_parts", "missingParts"],
  ["studio_import_no_bodies", "noBodies"],
  ["studio_import_failed", "readFailed"],
  ["studio_import_too_many_plates", "tooManyPlates"],
  ["studio_import_too_many_objects", "tooManyObjects"],
  ["studio_plate_pending", "loadPlateFirst"],
]);

export function studioErrorMessage(message: string, code: string | null | undefined): string {
  if (code === "studio_arrange_empty") return i18next.t("studio.print.arrangeEmpty", { ns: "app" });
  const key = code && importErrors.get(code);
  if (!key) return message;
  const { format } = new Intl.NumberFormat(i18next.resolvedLanguage);
  return i18next.t(`studio.importModel.${key}`, {
    ns: "app",
    objects: format(LIMITS.features),
    plates: format(MAX_PLATES),
    plateTriangles: format(LIMITS.sourcePlateTriangles),
    bodyTriangles: format(LIMITS.sourceBodyTriangles),
  });
}

async function requestResponse(path: string, method = "GET", payload?: unknown): Promise<Response> {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: authHeaders(payload === undefined ? undefined : { "Content-Type": "application/json" }),
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | null = null;
    try {
      const body = (await res.json()) as { detail?: unknown; code?: unknown };
      if (typeof body.detail === "string") message = body.detail;
      if (typeof body.code === "string") code = body.code;
    } catch {}
    throw new StudioError(studioErrorMessage(message, code), res.status, code);
  }
  return res;
}

async function request<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const res = await requestResponse(path, method, payload);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const design = (id: string) => `/studio/designs/${encodeURIComponent(id)}`;

export type StudioExport = {
  format?: "3mf" | "stl" | "stl-zip";
  slicer?: string;
  printer?: { id: string; nozzle: string };
  plate?: string;
  profile?: string;
};

export function studioExportPath(id: string, filename: string, options?: StudioExport): string {
  const parts = [
    options?.format ?? (options ? "3mf" : "auto"),
    options?.slicer ?? "-",
    options?.printer?.id ?? "-",
    options?.printer?.nozzle ?? "-",
    options?.plate ?? "-",
    ...(options?.profile ? [options.profile] : []),
    filename,
  ];
  return `${design(id)}/export/${parts.map(encodeURIComponent).join("/")}`;
}

/** How the grid behind a design is drawn and snapped to, as a CAD program's grid settings: adaptive, it follows the zoom
 *  at a density; fixed, it's `major` mm apart with `subdivisions` minor lines between. */
export type StudioGridSettings = {
  show: boolean;
  spacing: "adaptive" | "fixed";
  density: "coarse" | "normal" | "fine";
  major: number;
  subdivisions: number;
  snap: boolean;
};
/** A person's own Studio settings, kept on the account. */
export type StudioSettings = { units: "mm" | "cm" | "in"; grid: StudioGridSettings };

export const studioApi = {
  export: (id: string, filename: string, options?: StudioExport) =>
    requestResponse(studioExportPath(id, filename, options)),
  status: () => request<{ enabled: boolean }>("/studio/status"),
  settings: () => request<StudioSettings>("/studio/settings"),
  /** `grid` takes only what changes, as the rest do. */
  updateSettings: (changes: Partial<Omit<StudioSettings, "grid">> & { grid?: Partial<StudioGridSettings> }) =>
    request<StudioSettings>("/studio/settings", "PATCH", changes),
  aiModels: () => request<StudioAiModels>("/studio/ai-models"),
  list: () => request<StudioDesignSummary[]>("/studio/designs"),
  library: (q: string, offset = 0) =>
    request<{ models: StudioLibraryModel[]; next_offset: number | null }>(
      `/studio/library?${new URLSearchParams({ q, offset: String(offset) })}`,
    ),
  /** A design's copy of a mesh it imported, as frontend/src/studio/meshAsset.ts reads it. */
  asset: async (id: string, assetId: string): Promise<ArrayBuffer> => {
    const res = await fetch(`${apiBase()}${design(id)}/assets/${encodeURIComponent(assetId)}`, {
      headers: authHeaders(),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new StudioError(`Mesh not found (${res.status})`, res.status, null);
    return res.arrayBuffer();
  },
  create: (name: string) => request<StudioDesign>("/studio/designs", "POST", { name }),
  get: (id: string) => request<StudioDesign>(design(id)),
  version: (id: string) => request<{ version: number }>(`${design(id)}/version`),
  remove: (id: string, options?: { expected_version: number }) => request<void>(design(id), "DELETE", options),
  assistant: (id: string) => request<StudioAssistantThread>(`${design(id)}/assistant`),
  /** Starts the assistant on a prompt; it works in the background, which `assistant` follows. */
  ask: (
    id: string,
    body: {
      prompt: string;
      ai_connection_id: string | null;
      selected: string[];
      active_plate?: string;
      pictures?: string[];
    },
  ) => request<{ run: StudioAssistantRun }>(`${design(id)}/assistant`, "POST", body),
  /** Keeps a picture with the design: the server turns it upright and makes it no bigger than it needs. */
  addPicture: async (id: string, file: Blob): Promise<StudioPicture> => {
    const res = await fetch(`${apiBase()}${design(id)}/pictures`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": file.type || "application/octet-stream" }),
      body: file,
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      let message = `Upload failed (${res.status})`;
      try {
        const body = (await res.json()) as { detail?: unknown };
        if (typeof body.detail === "string") message = body.detail;
      } catch {}
      throw new StudioError(message, res.status, null);
    }
    return res.json();
  },
  /** Saves the visible, populated profiles as a new model, or adds them to the model given by `model_id`.
   *  `picture_id` is a picture to show a new model by; `picture_plate_id` the plate to picture it by without one, and
   *  the 3MF's thumbnail. */
  saveToLibrary: async (
    id: string,
    body: { name?: string; picture_id?: string; model_id?: string; profile_name?: string; picture_plate_id?: string },
  ) => {
    const saved = await request<{ model: { id: string; name: string; title: string | null } }>(
      `${design(id)}/save-to-library`,
      "POST",
      body,
    );
    // A design saved to the library counts towards an achievement.
    requestAchievementCheck();
    return saved;
  },
  /** A picture of one plate, as Save to Thingport offers it; `version` is the design's, so a changed one is new. */
  platePicture: async (id: string, plateId: string, version: number): Promise<Blob> => {
    const res = await fetch(`${apiBase()}${design(id)}/plates/${encodeURIComponent(plateId)}/picture?v=${version}`, {
      headers: authHeaders(),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new StudioError(`Plate picture failed (${res.status})`, res.status, null);
    return res.blob();
  },
  picture: async (id: string, pictureId: string): Promise<Blob> => {
    const res = await fetch(`${apiBase()}${design(id)}/pictures/${encodeURIComponent(pictureId)}`, {
      headers: authHeaders(),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new StudioError(`Picture not found (${res.status})`, res.status, null);
    return res.blob();
  },
  stopAssistant: (id: string) => request<{ run: StudioAssistantRun | null }>(`${design(id)}/assistant/stop`, "POST"),
  clearAssistant: (id: string) => request<void>(`${design(id)}/assistant`, "DELETE"),
  /** Every change to a design goes through here, as the same commands an assistant runs. */
  run: <N extends StudioCommandName>(id: string, command: N, args: StudioCommandArgs<N>) =>
    request<StudioCommandResult>(`${design(id)}/commands`, "POST", { command, args }),
};
