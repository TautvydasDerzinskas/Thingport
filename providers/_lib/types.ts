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
  helpers: { grab: Need; flaresolverr: Need };
  capabilities: {
    collections: boolean;
    likes: boolean;
    profiles: boolean;
    paidModels: boolean;
    /** How a category keeps this site's category ids: numbers, or text where they don't fit one (NexPrint's are
     *  past Int, Thangs' are paths). */
    categoryIds: "int" | "text";
  };
  /** The codes of the errors the API answers with, which clients act on: never change them. `session` when the
   *  sign-in is missing or turned down, `downloadLimit` when the account's daily downloads are used up, `needsGrab`
   *  when only Grab can fetch the files. */
  errorCodes: { session?: string; downloadLimit?: string; needsGrab?: string };
  extension: {
    /** "builtin" sites are in Grab's manifest.json, "optional" ones are asked for when the user turns them on. New
     *  providers are always optional: changing the built-in set makes browsers disable Grab until it's approved. */
    site: "builtin" | "optional";
    origins: readonly string[];
  };
};

export type ListKind = "collection" | "likes" | "bookmarks";

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
