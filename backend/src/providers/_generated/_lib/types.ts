// GENERATED from providers/_lib/types.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
// What a provider declares about itself. The generator (scripts/sync-providers.mjs) copies providers/ into the backend,
// frontend and extension, so nothing here may import from outside it. Manifests are pure data and import only types;
// a provider's urls.ts may use _lib/ too.

/** How much a provider leans on a helper: Thingport Grab or FlareSolverr. */
export type Need = "required" | "recommended" | "optional" | "none";

/** What Thingport needs before importing: nothing, the admin's instance key, each user's own sign-in, both, or a
 *  user's sign-in that only some things need. */
export type SignIn = "none" | "admin" | "user" | "adminUser" | "userOptional";

export type Logo = {
  /** Defaults to 0 0 24 24, Simple Icons' box. */
  viewBox?: string;
  /** A hex colour, or "currentColor" for a black-and-white mark that takes the text colour. */
  color: `#${string}` | "currentColor";
  path: string;
  fillRule?: "evenodd";
  /** Shapes in colours of their own, drawn after `path`. */
  layers?: readonly { d: string; color: `#${string}` }[];
};

export type Chip = {
  /** The chip's fill: a hex colour, or "text" for the theme's text colour. */
  bg: `#${string}` | "text";
  /** The label's colour, white when left out: a hex colour, "black", or "inverse" (white in dark mode, the paper
   *  colour in light mode) for a chip filled with the text colour. */
  fg?: `#${string}` | "black" | "inverse";
};

export type ProviderManifest = {
  /** Stored in the database and sent by clients: never change it. */
  id: string;
  name: string;
  /** Where it comes in lists: the legacy three first, as everywhere in the docs. */
  order: number;
  site: string;
  /** The page under docs/providers/ on the website. */
  docsSlug: string;
  /** The provider's domains; their subdomains count too. */
  hosts: readonly string[];
  brand: { logo: Logo; chip: Chip };
  signIn: SignIn;
  /** The credentials Thingport keeps for it, connected in Configuration → Providers; none for Printables. */
  auth: readonly AuthSlot[];
  helpers: { grab: Need; flaresolverr: Need };
  capabilities: {
    collections: boolean;
    likes: boolean;
    profiles: boolean;
    paidModels: boolean;
    /** How a category keeps this site's category ids: numbers, or text where they don't fit one (NexPrint's are
     *  past Int, Thangs' are paths). */
    categoryIds: "int" | "text";
    /** The list the dashboard's trending panel shows: its trending one, or the popular, featured or recommended one
     *  standing in where it has none, and that list's page on the site. `rank` is its place among the panel's
     *  providers. False for a provider with no such list. */
    trending: false | { kind: "trending" | "popular" | "featured" | "recommended"; moreUrl: string; rank: number };
  };
  /** The codes of the errors the API answers with, which clients act on: never change them. `session` when the
   *  sign-in is missing or turned down, `downloadLimit` when the account's daily downloads are used up, `needsGrab`
   *  when only Grab can fetch the files. */
  errorCodes: { session?: string; downloadLimit?: string; needsGrab?: string };
  /** The endpoints it had before the generic /import/<id>/list and /profiles ones, kept as aliases of them for
   *  clients that still call them: never change them. Providers added since have none. */
  legacy?: {
    /** `/import/<path>/entries` and `/import/<path>`, for the kinds of list given (any when left out), the picked
     *  models' ids in `idsField`. */
    lists: readonly { path: string; kinds?: readonly ListKind[]; idsField: LegacyIdsField }[];
    /** `/import/<profiles>`. */
    profiles?: string;
  };
  extension: {
    /** "builtin" sites are in Grab's manifest.json, "optional" ones are asked for when the user turns them on. New
     *  providers are always optional: changing the built-in set makes browsers disable Grab until it's approved. */
    site: "builtin" | "optional";
    origins: readonly string[];
  };
};

/** One field of a credential's connect form, by the name the API takes it under. */
export type AuthField = { name: string; secret?: boolean; multiline?: boolean };

export type AuthSlot = {
  /** "default" is the one its tile connects. Others: Cults3D's "browser" sign-in its downloads need besides its API
   *  key, MyMiniFactory's "instance" API key beside each user's sign-in. */
  slot: "default" | "browser" | "instance";
  /** One credential for the whole instance, which only an admin sets, or each user's own. */
  scope: "instance" | "user";
  fields: readonly AuthField[];
  /** `/settings/<path>`, which it had before /providers/<id>/connection, kept as an alias: never change it. `noGet`
   *  where it had no GET, its state coming with the default slot's. */
  legacyEndpoint?: { path: string; method: "POST" | "PATCH"; noGet?: true };
};

export type ListKind = "collection" | "likes" | "bookmarks";

export type LegacyIdsField = "design_ids" | "thing_ids" | "object_ids" | "model_ids";

/** A model page, by the id Thingport keeps for it and the print profile the link names, if any. */
export type ModelLink = { externalId: string; requestedProfileId: string | null };

/** A list a sync can follow: `externalId` is what it's kept by, `url` its canonical page. `likesOf` names whose likes
 *  they are, where the page belongs to a user other than the signed-in one can be. */
export type ListLink = { kind: ListKind; externalId: string; url: string; likesOf?: string };

/** How a provider's links are read and written, the same in the backend, the app and Grab. */
export type ProviderUrls = {
  /** Whether a host is the site's, as its links are read. */
  isHost(hostname: string): boolean;
  parseModel(url: string): ModelLink | null;
  parseList(url: string): ListLink | null;
  /** The page of a model by its id. */
  modelUrl(externalId: string): string;
};
