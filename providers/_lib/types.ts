// What a provider declares about itself. Pure data: the generator (scripts/sync-providers.mjs) copies this folder into
// the backend, frontend and extension, so it may import nothing but other files in providers/, and only types.

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
  capabilities: { collections: boolean; likes: boolean; profiles: boolean; paidModels: boolean };
  extension: {
    /** "builtin" sites are in Grab's manifest.json, "optional" ones are asked for when the user turns them on. New
     *  providers are always optional: changing the built-in set makes browsers disable Grab until it's approved. */
    site: "builtin" | "optional";
    origins: readonly string[];
  };
};
