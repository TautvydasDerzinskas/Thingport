// Typed runtime messages between the content script/popup and the background. Replies use a
// `{ ok, data } | { ok: false, error }` envelope: `send` returns it, `request` throws on error.

import type { Print, QueueImportResult } from "./api";

export type ExtensionState = {
  configured: boolean;
  disabled: boolean;
  /** Admins can send an import to the instance's paused import queue instead. */
  isAdmin: boolean;
  instanceUrl: string;
  email: string;
  /** Connected by approving Grab in Thingport, not with a saved password. */
  connectedByApproval: boolean;
};

/** Whether the saved instance URL, email and password still sign in. */
export type Connection =
  | { connected: true }
  | {
      connected: false;
      reason: "credentials" | "unreachable";
      detail: string;
      /** "credentials" then means the connection was removed in Thingport, not a changed password. */
      byApproval?: boolean;
    };

/** Providers whose signed-in user the extension tells the instance, for its Browse tab. MakerWorld
 *  needs none: the instance has its session cookie. */
export type AccountProvider = "printables" | "thingiverse";

/** `wanted`: the private collections whose models the instance asked for. `likes`: whether to read
 *  every page of the user's likes this time. */
export type PrintablesPushPlan = { wanted: string[]; likes: boolean };

/** What Grab read on Printables with the user's own login: their collections, private ones
 *  included, their likes, and the models of the private collections the instance asked for. */
export type PrintablesPush = {
  user: { id: string; handle: string };
  collections?: { id: string; name: string; model_count: number; thumbnails: string[]; private: boolean }[];
  likes?: { model_count: number; thumbnails: string[]; ids: string[] };
  listings: Record<string, string[]>;
};

/** The signed-in account's recent imports, as the popup shows them. */
export type RecentImport = {
  printId: string;
  title: string | null;
  url: string;
  thumbDataUrl: string | null;
};

/** See content/makerworld/downloadResolver.ts. */
/** `design` is absent when the page data couldn't be trusted to be this model's. */
export type ResolvedDownload = {
  downloadUrl: string;
  instanceId: string | null;
  design?: Record<string, unknown> | null;
};

export type ImportSinglePayload = {
  url: string;
  entries?: string[];
  collectionId?: string | null;
  resolved?: ResolvedDownload | null;
  title?: string | null;
};

export type QueueImportPayload = {
  url: string;
  collectionId?: string | null;
  scope?: "url" | "designer" | "all";
  title?: string | null;
};

export type MakerworldJob = {
  tabId: number;
  originalUrl: string;
  collectionId: string | null;
  urls: string[];
  index: number;
  imported: number;
  total: number;
  awaitingLoad: boolean;
  /** Wait before each model after the first, so a long run stays under MakerWorld's limits. */
  stepDelayMs: number;
  /** When the current model's step may start; its page counts down to it. */
  startAt: number;
  /** MakerWorld wants a CAPTCHA: the run waits on this model until the user resumes it. */
  paused: boolean;
  /** The models imported so far, for the run's one notification. Missing on a run saved by an older version. */
  printIds?: string[];
};

export type MakerworldJobError = { message: string; imported: number; total: number };

export type ApiCallPayload = { method: string; path: string; body?: unknown };

export type BackgroundMessages = {
  GET_STATE: { payload: void; result: ExtensionState };
  SAVE_CONFIG: { payload: { instanceUrl: string; email: string; password: string }; result: null };
  SET_DISABLED: { payload: { disabled: boolean }; result: null };
  /** Opens Thingport to approve this browser's Grab; it finishes in the background once approved. */
  START_PAIRING: { payload: { instanceUrl: string }; result: null };
  GET_RECENT_IMPORTS: { payload: void; result: RecentImport[] };
  CHECK_CONNECTION: { payload: void; result: Connection };
  /** Printables' session token, which the page itself can't read. Null when signed out. */
  GET_PRINTABLES_TOKEN: { payload: void; result: string | null };
  /** Who the user is signed in as on a provider, read from its pages. */
  REPORT_PROVIDER_ACCOUNT: { payload: { provider: AccountProvider; value: string }; result: null };
  /** What to read on Printables now, or null when it isn't time to read anything. */
  /** `now`: skip the hourly wait, e.g. right after a private collection's sync was turned on. */
  PRINTABLES_PUSH_DUE: { payload: { now?: boolean }; result: PrintablesPushPlan | null };
  PUSH_PRINTABLES: { payload: PrintablesPush; result: null };
  OPEN_SETUP: { payload: void; result: "popup" | "tab" };
  SET_TAB_ICON_STATE: { payload: { active: boolean }; result: null };
  API_CALL: { payload: ApiCallPayload; result: unknown };
  IMPORT_SINGLE: { payload: ImportSinglePayload; result: Print | null };
  QUEUE_IMPORT: { payload: QueueImportPayload; result: QueueImportResult };
  START_MAKERWORLD_COLLECTION_JOB: {
    payload: { urls: string[]; collectionId: string | null; originalUrl: string; stepDelayMs: number };
    result: null;
  };
  ABORT_MAKERWORLD_COLLECTION_JOB: { payload: void; result: null };
  RESUME_MAKERWORLD_JOB: { payload: void; result: null };
  MAKERWORLD_JOB_STEP_DUE: { payload: void; result: null };
  FORCE_ADVANCE_MAKERWORLD_JOB: { payload: void; result: null };
  ARM_DOWNLOAD_CAPTURE: { payload: void; result: null };
  AWAIT_DOWNLOAD_CAPTURE: { payload: void; result: string | null };
  DISARM_DOWNLOAD_CAPTURE: { payload: void; result: null };
  GET_MAKERWORLD_JOB: { payload: void; result: { job: MakerworldJob | null; error: MakerworldJobError | null } };
};

export type ContentMessages = {
  RESOLVE_MAKERWORLD_DOWNLOAD_URL: { payload: void; result: ResolvedDownload | null };
  /** The guided import paused on this page; it re-renders. */
  MAKERWORLD_JOB_UPDATED: { payload: void; result: null };
};

type AnyMessages = Record<string, { payload: unknown; result: unknown }>;
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
type Envelope<M extends AnyMessages, K extends keyof M> = { type: K; payload: M[K]["payload"] };
type PayloadArgs<P> = [P] extends [void] ? [] : [P];

export type BackgroundType = keyof BackgroundMessages;
export type BackgroundResult<K extends BackgroundType> = BackgroundMessages[K]["result"];

export function send<K extends BackgroundType>(
  type: K,
  ...payload: PayloadArgs<BackgroundMessages[K]["payload"]>
): Promise<Reply<BackgroundResult<K>>> {
  const message: Envelope<BackgroundMessages, K> = { type, payload: payload[0] as BackgroundMessages[K]["payload"] };
  return chrome.runtime.sendMessage(message);
}

export async function request<K extends BackgroundType>(
  type: K,
  ...payload: PayloadArgs<BackgroundMessages[K]["payload"]>
): Promise<BackgroundResult<K>> {
  const reply = await send(type, ...payload);
  if (!reply) throw new Error("No response from the extension background");
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}

export async function sendToTab<K extends keyof ContentMessages>(
  tabId: number,
  type: K,
): Promise<Reply<ContentMessages[K]["result"]> | undefined> {
  return chrome.tabs.sendMessage(tabId, { type, payload: undefined });
}

type Handler<M extends AnyMessages, K extends keyof M> = (
  payload: M[K]["payload"],
  sender: chrome.runtime.MessageSender,
) => Promise<M[K]["result"]> | M[K]["result"];
export type Handlers<M extends AnyMessages> = { [K in keyof M]: Handler<M, K> };

/** Message types not in `handlers` are left for other listeners. */
export function listen<M extends AnyMessages>(handlers: Partial<Handlers<M>>): void {
  chrome.runtime.onMessage.addListener((message: { type?: string; payload?: unknown }, sender, sendResponse) => {
    const handler = message && typeof message.type === "string" ? handlers[message.type as keyof M] : undefined;
    if (!handler) return undefined;
    Promise.resolve()
      .then(() => handler(message.payload as never, sender))
      .then(
        (data) => sendResponse({ ok: true, data }),
        (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
    return true; // keep the channel open for the async sendResponse above
  });
}
