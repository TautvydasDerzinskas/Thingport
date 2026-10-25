// What a provider module gives the import pipeline (services/importService.ts importSourced and addSourcedProfile),
// which does the rest the same way for every provider: refusing a turned-off one, deduplicating, the print, its
// author, category and gallery, and the temp files.

import type { CollectionSync, Prisma } from "@prisma/client";
import type { z } from "zod";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../services/importResolvers";
import type {
  ExistingImportedPrint,
  ImportRequestBody,
  ImportResult,
  PlainDownloadResult,
  ProfileDetails,
} from "../services/importService";
import type { NewPlateInput } from "../services/printCreation";
import type { TrendingSetup } from "../services/providerTrendingService";
import type { ProviderCollectionCard } from "../services/providerCollectionCard";
import type { TrendingModel } from "../services/trendingModel";
import type { HttpError } from "../utils/fileUtils";
import type { ProviderId } from "./index.generated";
import type { SyncProblem } from "./syncProblem";

/** A model as its provider describes it. */
export type ResolvedModel = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  /** Its print profiles, for naming their files apart and showing their pictures; none for a provider without. */
  profiles?: { id: string; title: string; coverUrl?: string | null }[];
};

/** What the pipeline lends a provider to fetch files with. */
export type ImportKit = {
  /** A signed file link on one of the provider's own hosts, downloaded; a zip unpacked into its model files. Null
   *  when it didn't download; a block is thrown as a 429 with `blockedMessage`. */
  downloadSignedFile(
    file: { url: string; name: string },
    isFileHost: (hostname: string) => boolean,
    blockedMessage: string,
  ): Promise<NewPlateInput[] | null>;
  /** A plain file link, downloaded as it is; a block is retried once, then reported. Null when it didn't download. */
  downloadFile(url: string, name: string): Promise<PlainDownloadResult>;
  /** Whether a file is one a plate takes (a zip is unpacked instead). */
  isModelFile(name: string): boolean;
};

/** Whose import it is, and of which model, by the id it's kept under. */
export type ImportTarget = { userId: string; externalId: string };

/** A provider whose model files the server downloads, as the user it holds credentials for. */
export type SourcedImport<Auth = unknown, Model extends ResolvedModel = ResolvedModel> = {
  /** The user's credentials, or the HttpError (400 with the manifest's session code) that says to connect. */
  requireAuth(userId: string): Promise<Auth>;
  resolveModel(externalId: string, auth: Auth): Promise<Model | null>;
  /** The id a model is kept under, where it isn't the one its link has (Creality Cloud's alias, for a link by id). */
  canonicalId?(model: Model): string;
  /** The provider's errors as the HttpErrors an import reports, remembering a rejected sign-in; others as they are. */
  mapError(userId: string, err: unknown): Promise<unknown>;
  /** The 404 for a model it doesn't know, or doesn't show. */
  missingMessage: string;
  /** The 400 for a model with nothing to import. */
  noFilesMessage: string;
  /** What a print is named when the model has no title; `<provider>-<id>` when left out. */
  nameHint?(externalId: string): string;
  /** The files of a new print: the profile `requestedProfileId` names, or its own pick. Empty when there are none;
   *  removes what it downloaded when it throws. */
  downloadModel(
    target: ImportTarget,
    model: Model,
    auth: Auth,
    requestedProfileId: string | null,
    kit: ImportKit,
  ): Promise<NewPlateInput[]>;
  /** For a provider with print profiles. */
  profiles?: {
    /** One profile's file, tagged with it, for an existing print; null when the model has no such profile. `model`
     *  is null when `downloadsWithoutModel`. */
    download(
      target: ImportTarget,
      model: Model | null,
      profileId: string,
      auth: Auth,
      kit: ImportKit,
    ): Promise<NewPlateInput | null>;
    /** Whether a profile downloads without the model's details, which then only name and picture it: a re-import
     *  still brings the profile when they can't be read. */
    downloadsWithoutModel?: boolean;
    /** The 404 for a profile the model hasn't got. */
    missingMessage: string;
    /** Whether its profile files come named alike, so they're named after their profiles. */
    namedAlike: boolean;
    /** The profiles a scope picks from the model a link is of, as links that each name one, for the batch that
     *  imports them onto one print. */
    listUrls(url: string, scope: "designer" | "all"): Promise<{ title: string | null; urls: string[] }>;
  };
};

/** What the pipeline lends a provider that imports its own way, past its downloads. */
export type PipelineKit = ImportKit & {
  /** A new print of the downloaded files; removes them either way. */
  createPrint(
    userId: string,
    source: { provider: string; externalId: string },
    body: ImportRequestBody,
    resolved: ResolvedModel,
    downloaded: NewPlateInput[],
    details: ProfileDetails,
  ): Promise<ImportResult>;
  /** Each profile's file, tagged with it, onto an existing print, told apart by name and picture; removes them
   *  either way. Already imported when none was new. */
  addProfiles(existing: ExistingImportedPrint, inputs: NewPlateInput[], details: ProfileDetails): Promise<ImportResult>;
  profileDetails(
    profiles: { id: string; title: string; coverUrl?: string | null }[],
    options?: { names?: boolean },
  ): ProfileDetails;
};

/** The escape hatch for a provider whose imports don't go the shared way (MakerOnline's files come from Grab). */
export type CustomImport = {
  importModel(
    userId: string,
    source: { provider: string; externalId: string },
    body: ImportRequestBody,
    kit: PipelineKit,
  ): Promise<ImportResult>;
  /** A re-import of a model already in the library. */
  addToExisting(existing: ExistingImportedPrint, body: ImportRequestBody, kit: PipelineKit): Promise<ImportResult>;
};

/** One model of a list, to pick from. */
export type ListEntry = { externalId: string; title: string; cover: string | null };

/** A list as its provider reads it for the import dialog: up to the first few hundred of its models. */
export type ProviderList = { title: string | null; total: number; truncated: boolean; entries: ListEntry[] };

/** A list import: the models picked from it, and what to file them with. */
export type ListImportBody = ImportRequestBody & {
  model_ids: string[];
  /** The list's name as Thingport Grab read it, where the server can't (a private Printables collection). */
  collection_title?: string | null;
};

/** The picked models of a list, imported one by one into a collection named after it. */
export type ListBatch = {
  /** Throws the error that fails the job before any import, when the provider can't import yet. */
  ready?(): Promise<void>;
  /** The collection's name, asked for once the imports are done. */
  title(): Promise<string>;
  /** How the notification names the list: the title in quotes when left out. */
  label?(title: string): string;
};

/** How a list import goes: as a batch job, a job of the provider's own (MakerWorld), or waiting for Grab to import
 *  each model on the provider's own pages (MakerOnline), filed into a collection called `title`. */
export type ListImportStart =
  { batch: ListBatch } | { run(jobId: string): Promise<void> } | { waitForGrab: { title: string } };

/** A provider whose collections, likes or bookmarks import. The route has checked the link is one of its lists. */
export type ProviderLists = {
  /** The list a link is of, as the user; a 400 when it has no models. */
  read(userId: string, url: string, body: ImportRequestBody): Promise<ProviderList>;
  /** What the picked models' ids must look like; any non-empty list of strings when left out. */
  modelIds?: z.ZodType<string[], z.ZodTypeDef, unknown>;
  start(userId: string, url: string, body: ListImportBody): Promise<ListImportStart>;
  /** Whether a list import waits for Grab rather than run as a job, so it doesn't wait for a running one. */
  waitsForGrab?: boolean;
  /** The notification's words for models a rate limit or a rejected sign-in stopped, after their count; the latter
   *  `failed because` the provider's authStopText when left out. */
  rateLimitText?: string;
  authText?: string;
  /** Its words for models that couldn't be found, after their count. */
  unavailableText?: string;
};

/** A list a sync can follow, by its link. `likesOf` is set for a user's likes (on Thingiverse or Cults3D, or the
 *  user's own on Printables), which a sync follows like a collection. */
export type SyncSource = { provider: ProviderId; externalId: string; url: string; likesOf?: string };

/** A synced collection, likes or bookmarks, as a check of it reads them. */
export type SyncedList = Pick<CollectionSync, "userId" | "externalId" | "sourceUrl">;

/** How the provider's synced lists are checked (services/collectionSyncRunner.ts). */
export type ProviderSync = {
  /** The list's model ids, or null when the provider says it no longer exists. Throws when there's no clear answer,
   *  so an outage never unsyncs anything; a SyncHeldError holds this sync alone. */
  fetchListing(sync: SyncedList): Promise<string[] | null>;
  /** Why the provider can't be reached for this sync now, or null when it can. Checked before any call, so a sync
   *  with nothing to sign in with waits instead of failing every round. */
  connectionProblem?(sync: SyncedList): Promise<SyncProblem | null>;
  /** Whether only this list of its lists needs the sign-in, so only it waits for one (likes, where its collections
   *  read without). */
  signInOnly?(externalId: string): boolean;
  /** The provider turning the sign-in down mid-check: remembered, and its syncs held, or only this one's with
   *  `onlyThis`. */
  rejected?: { is(err: unknown): boolean; mark(userId: string): Promise<void>; problem: SyncProblem; onlyThis?: true };
  /** Every problem it holds a sync for, so "Sync now" on a held one says it again. */
  problems: readonly SyncProblem[];
  /** The 400 for a list the user can't sync: someone else's that only its owner sees, or one read with a sign-in
   *  they haven't given. */
  assertCanSync?(userId: string, source: SyncSource): Promise<void>;
  /** Whether the list's models wait for Thingport Grab to read them (a private Printables collection, until the
   *  user's next visit there). */
  waitingForGrab?(userId: string, externalId: string): Promise<boolean>;
  /** The name of the collection a list is synced into, where the list's own says nothing (the user's likes or
   *  bookmarks); null for one named by its title. Someone's likes are named after them without it. */
  listName?(source: SyncSource): string | null;
};

/** Who the user is on the provider, for the sync dialog's Browse tab. `connected`: the instance can reach it for
 *  them at all. `account`: who they are there, where they said so rather than its sign-in. */
export type ProviderAccount = { connected: boolean; account: string | null };

/** The sync dialog's Browse tab (services/providerCollectionsService.ts). Errors the user can act on are mapped to
 *  HTTP ones by `httpError`. */
export type ProviderBrowse = {
  account(userId: string): Promise<ProviderAccount>;
  /** Saves who the user is there, from a username, handle or profile link; null forgets it. */
  setAccount?(userId: string, value: string | null): Promise<void>;
  /** What says who the user is instead, for a provider without `setAccount`. */
  linkedThrough?: "sign-in" | "API key" | "cookie";
  /** The user's lists, to sync with. Throws the 409 that says what to connect or give first. */
  cards(userId: string): Promise<ProviderCollectionCard[]>;
  /** A pasted list link, as the same card; null when it can't be found. */
  card(userId: string, source: SyncSource): Promise<ProviderCollectionCard | null>;
  /** One of its errors the user can act on, as the HTTP error to answer with; undefined for any other. */
  httpError?(err: unknown): HttpError | undefined;
};

/** The list for the dashboard's trending panel (the manifest's capabilities.trending says which it is). */
export type ProviderTrending = {
  /** Up to `limit` models, or the setup it can't be read without (an admin's token or key, or the user's own). */
  fetch(userId: string, limit: number): Promise<TrendingModel[] | TrendingSetup>;
  /** Read with each user's own key, so one user's list isn't kept for the others. */
  perUser?: boolean;
};

export type ConnectionStatus = "connected" | "expired" | "disconnected";

/** One of the credentials the manifest lists under `auth`, as Configuration → Providers shows and changes it. */
export type ConnectionSlot = {
  /** Expired: the provider has since turned it down. `account` names whose it is, where that's known. */
  status(userId: string): Promise<{ status: ConnectionStatus; account?: string | null }>;
  /** Saves the credential the body holds, checked with the provider when it says `verify`; an empty one forgets it.
   *  Answers what the legacy endpoint did. A 422 for one that isn't a sign-in or is turned down, a 503 when it can't
   *  be checked. */
  save(userId: string, body: unknown): Promise<Record<string, unknown>>;
  /** What the legacy endpoint's GET answered, where that was more than `configured` and `expired`. */
  legacyStatus?(userId: string): Promise<Record<string, unknown>>;
};

/** Why a run over many models stops reading a provider's (services/authorLinkingService.ts,
 *  descriptionRefetchService.ts): a code the app words, kept in the audit log, so never change one. */
export type LookupProblem = `${ProviderId}_${string}`;

/** A model's details read without its files: for filling a print's gaps (services/fillGapsService.ts), and for the
 *  runs that re-read descriptions and look up authors. */
export type ProviderDetails = {
  /** The model's details, as the user; null when the provider doesn't know it or doesn't show it. Throws the
   *  HttpError that says what to connect first, and the provider's own errors as they are, for `problemOf`. */
  read(userId: string, externalId: string): Promise<ImportedPageMetadata | null>;
  /** Only its author, where that's cheaper than all of `read`. */
  author?(userId: string, externalId: string): Promise<ImportedAuthorInfo | null>;
  /** The 404 for a model `read` found nothing for. */
  missingMessage: string;
  /** One of its errors as the HttpError a single read answers with; any other as it is. */
  mapError?(userId: string, err: unknown): Promise<unknown>;
  /** Why a run can't read any of its models, checked before the first: once per run, or with `perUser` for each user
   *  whose models they are, read with their own key. */
  unavailable?:
    | { perUser?: false; check(): Promise<LookupProblem | null> }
    | { perUser: true; check(userId: string): Promise<LookupProblem | null> };
  /** For a provider read with each user's own key: the condition on `u` (their User row) that they have one it takes,
   *  so author lookups pick a model of theirs. */
  readableBy?: Prisma.Sql;
  /** One of its errors as the reason a run stops reading its models: all of them, or with `perUser` only those of
   *  the user whose sign-in it turned down. Null for any other. */
  problemOf?(err: unknown): { problem: LookupProblem; perUser?: true } | null;
  /** Its reads are paced by themselves, so a run doesn't wait between them too. */
  pacesItself?: true;
};

/** A provider's own words where a held sync or a stopped import would give the general ones. */
export type StopTexts = {
  /** Its sign-in turned down: why a sync's job paused, what a sync it handed models back to keeps, and the
   *  notification's words for the models left for later. */
  auth?: { paused: string; handedBack: string; deferred: string };
  /** Too many requests: why a sync's job paused. */
  rateLimited?: string;
  /** Cloudflare's block, where FlareSolverr is no way past it. */
  blocked?: string;
};

/** How the instance's own credential for a provider is, for Administration → System health. */
export type InstanceHealth = "ok" | "not_configured" | "rejected" | "blocked" | "unreachable";

/** Which of a model's print profiles an import brings: the one its link names, the designer's, or all. */
export type ProfileScope = "url" | "designer" | "all";
