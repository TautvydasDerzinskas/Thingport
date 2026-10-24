// What a provider module gives the import pipeline (services/importService.ts importSourced and addSourcedProfile),
// which does the rest the same way for every provider: refusing a turned-off one, deduplicating, the print, its
// author, category and gallery, and the temp files.

import type { ImportedPageMetadata } from "../services/importResolvers";
import type { NewPlateInput } from "../services/printCreation";

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
};

/** A provider whose model files the server downloads, as the user it holds credentials for. */
export type SourcedImport<Auth = unknown, Model extends ResolvedModel = ResolvedModel> = {
  /** The user's credentials, or the HttpError (400 with the manifest's session code) that says to connect. */
  requireAuth(userId: string): Promise<Auth>;
  resolveModel(externalId: string, auth: Auth): Promise<Model | null>;
  /** The provider's errors as the HttpErrors an import reports, remembering a rejected sign-in; others as they are. */
  mapError(userId: string, err: unknown): Promise<unknown>;
  /** The 404 for a model it doesn't know, or doesn't show. */
  missingMessage: string;
  /** The 400 for a model with nothing to import. */
  noFilesMessage: string;
  /** The files of a new print: the profile `requestedProfileId` names, or its own pick. Empty when there are none. */
  downloadModel(model: Model, auth: Auth, requestedProfileId: string | null, kit: ImportKit): Promise<NewPlateInput[]>;
  /** For a provider with print profiles: one profile's file, tagged with it, for an existing print. Null when the
   *  model has no such profile. */
  profiles?: {
    download(model: Model, profileId: string, auth: Auth, kit: ImportKit): Promise<NewPlateInput | null>;
    /** The 404 for a profile the model hasn't got. */
    missingMessage: string;
    /** Whether its profile files come named alike, so they're named after their profiles. */
    namedAlike: boolean;
    /** The profiles a scope picks from the model a link is of, as links that each name one, for the batch that
     *  imports them onto one print. */
    listUrls(url: string, scope: "designer" | "all"): Promise<{ title: string | null; urls: string[] }>;
  };
};
