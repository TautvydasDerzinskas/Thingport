import { authHeaders } from "../utils/auth";
import { apiBase, assertOk } from "./client";
import { FRONTEND_VERSION } from "./settings";

export type ReleaseNoteKind = "breaking" | "feature" | "improvement" | "fix";

export type ReleaseNoteItem = {
  kind: ReleaseNoteKind;
  title: string;
  description: string | null;
  scope: string | null;
  images: { url: string; caption: string | null }[];
  /** A command to copy. */
  code: string | null;
  /** Shown as a large card above the rest. */
  highlight: boolean;
  url: string | null;
};

export type ReleaseNotes = {
  version: string;
  /** "curated" from release-notes/latest-release-notes.json, "changelog" from CHANGELOG.md, "none" when unreachable. */
  source: "curated" | "changelog" | "none";
  title: string | null;
  summary: string | null;
  items: ReleaseNoteItem[];
  releases_url: string;
};

export const releaseNotesApi = {
  /** The backend's own version without `version`; `since` widens the notes to every release after it. */
  get: async (options: { version?: string | null; since?: string | null } = {}): Promise<ReleaseNotes> => {
    const params = new URLSearchParams();
    if (options.version) params.set("version", options.version);
    if (options.since) params.set("since", options.since);
    if (FRONTEND_VERSION) params.set("frontend", FRONTEND_VERSION);
    const res = await fetch(`${apiBase()}/release-notes?${params}`, { headers: authHeaders() });
    assertOk(res, "Failed to load what's new");
    return res.json();
  },
};
