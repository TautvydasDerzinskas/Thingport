import { authHeaders } from "../utils/auth";
import { apiBase, readErrorMessage, UnauthorizedError } from "./client";

/** Ready-made destinations: three kinds of printer, and three webhook services. */
export const SEND_PRESETS = ["octoprint", "moonraker", "prusalink", "homeassistant", "n8n", "nodered"] as const;
export type SendPreset = (typeof SEND_PRESETS)[number];
export const PRINTER_PRESETS: readonly SendPreset[] = ["octoprint", "moonraker", "prusalink"];

/** What an address may have filled in, as `{name}`. */
export const SEND_PLACEHOLDERS = [
  "file_url",
  "filename",
  "model_id",
  "model_name",
  "model_url",
  "plate_id",
  "source_url",
] as const;

export type SendHeader = { name: string; secret: boolean; value?: string };

/** How a destination is reached, as the backend's sendTargetFormat.ts has it. */
export type SendHow =
  | { type: "preset"; preset: SendPreset; address: string; start: boolean }
  | { type: "link"; url: string; open: "new" | "named" | "same"; tab?: string }
  | {
      type: "request";
      method: "POST" | "PUT";
      url: string;
      body: "multipart" | "raw" | "json";
      fileField: string;
      fields: { name: string; value: string }[];
      headers: SendHeader[];
      thenOpen?: string;
    };

export type SendPlacement = "button" | "menu";

/** One of the user's destinations, as Configuration edits it: which secrets are kept, never their values. */
export type SendTarget = {
  id: string;
  name: string;
  placement: SendPlacement;
  file_types: string[];
  how: SendHow;
  secrets: { api_key: boolean; headers: string[] };
};

/** What a model's page needs of one, from the slicer settings it reads anyway. */
export type SendTargetSummary = {
  id: string;
  name: string;
  kind: SendHow["type"];
  preset: SendPreset | null;
  placement: SendPlacement;
  file_types: string[];
  /** A link's tab, so the page opens it in the click itself. */
  open: "new" | "named" | "same" | null;
  tab: string | null;
};

/** What's saved: `apiKey` left out keeps the stored one, null removes it; a secret header without a value likewise. */
export type SendTargetInput = {
  name: string;
  placement: SendPlacement;
  fileTypes: string[];
  how: SendHow;
  apiKey?: string | null;
};

export type SendReason =
  | "auth"
  | "not_found"
  | "conflict"
  | "too_large"
  | "unsupported"
  | "redirect"
  | "http"
  | "timeout"
  | "unreachable"
  | "blocked";

export type SendOutcome = { ok: true; status: number } | { ok: false; reason: SendReason; status?: number };

export type SendResult =
  | { open: { url: string; mode: "new" | "named" | "same"; tab: string | null } }
  | (SendOutcome & { then_open?: string });

/** What an export holds: no secrets. */
export type SendExport = {
  kind: "thingport-send-to";
  version: 1;
  targets: { name: string; placement: SendPlacement; fileTypes: string[]; how: SendHow }[];
};

async function failed(res: Response, fallback: string): Promise<never> {
  if (res.status === 401) throw new UnauthorizedError();
  throw new Error(await readErrorMessage(res, fallback));
}

const json = (body: unknown) => ({
  headers: authHeaders({ "Content-Type": "application/json" }),
  body: JSON.stringify(body),
});

export const sendTargetsApi = {
  list: async (): Promise<SendTarget[]> => {
    const res = await fetch(`${apiBase()}/me/send-targets`, { headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to read where you send models");
    return (await res.json()).targets;
  },

  create: async (input: SendTargetInput): Promise<SendTarget> => {
    const res = await fetch(`${apiBase()}/me/send-targets`, { method: "POST", ...json(input) });
    if (!res.ok) return failed(res, "Failed to save the destination");
    return res.json();
  },

  /** Its settings but where it shows, which `place` sets and this leaves as it is. */
  update: async (id: string, input: Omit<SendTargetInput, "placement">): Promise<SendTarget> => {
    const res = await fetch(`${apiBase()}/me/send-targets/${encodeURIComponent(id)}`, {
      method: "PUT",
      ...json(input),
    });
    if (!res.ok) return failed(res, "Failed to save the destination");
    return res.json();
  },

  /** Its own button, or in the menu: that alone. */
  place: async (id: string, placement: SendPlacement): Promise<SendTarget> => {
    const res = await fetch(`${apiBase()}/me/send-targets/${encodeURIComponent(id)}/placement`, {
      method: "PUT",
      ...json({ placement }),
    });
    if (!res.ok) return failed(res, "Failed to save the destination");
    return res.json();
  },

  remove: async (id: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/me/send-targets/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) return failed(res, "Failed to delete the destination");
  },

  /** Tests the settings as they're being edited: `id` null for a new one, else a saved one's with its kept secrets
   *  where none were typed in. */
  test: async (id: string | null, input: SendTargetInput): Promise<SendOutcome> => {
    const at = id ? `${encodeURIComponent(id)}/test` : "test";
    const res = await fetch(`${apiBase()}/me/send-targets/${at}`, { method: "POST", ...json(input) });
    if (!res.ok) return failed(res, "Failed to test the destination");
    return res.json();
  },

  exportAll: async (): Promise<SendExport> => {
    const res = await fetch(`${apiBase()}/me/send-targets/export`, { headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to export");
    return res.json();
  },

  /** The destinations it added, not the whole list. */
  importAll: async (file: unknown): Promise<SendTarget[]> => {
    const res = await fetch(`${apiBase()}/me/send-targets/import`, { method: "POST", ...json(file) });
    if (!res.ok) return failed(res, "Failed to import");
    return (await res.json()).targets;
  },

  /** `file` is the model page's own key: a plate's id, or "prepared". */
  send: async (printId: string, targetId: string, file: string): Promise<SendResult> => {
    const res = await fetch(`${apiBase()}/print/${encodeURIComponent(printId)}/send/${encodeURIComponent(targetId)}`, {
      method: "POST",
      ...json({ file }),
    });
    if (!res.ok) return failed(res, "Failed to send the model");
    return res.json();
  },
};
