import type { ListLink, ModelLink, ProviderUrls } from "../_lib/types";

const SITE_ORIGIN = "https://cults3d.com";

function isHost(hostname: string): boolean {
  return /^(www\.)?cults3d\.com$/i.test(hostname);
}

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return isHost(parsed.hostname) ? parsed : null;
  } catch {
    return null;
  }
}

/** The path's segments, decoded: the site writes them in each language, accents and all ("modèle-3d"). */
function segments(parsed: URL): string[] {
  return parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part).toLowerCase();
      } catch {
        return part.toLowerCase();
      }
    });
}

// What each of the site's languages calls a model page, a user and their likes, and printlists (which the site calls
// "design collections").
const MODEL_WORDS = new Set([
  "3d-model",
  "modell-3d",
  "modelo-3d",
  "modèle-3d",
  "modello-3d",
  "3d-moderu",
  "3d-móxíng",
]);
const LIKES_WORDS = new Set(["likes", "mi-piace", "iine-ichiran", "curtidas", "laiki", "beğeniler", "xǐhuān"]);
const PRINTLIST_WORDS = new Set([
  "design-collections",
  "drucklisten",
  "colecciones-de-diseños",
  "collections-de-designs",
  "raccolta-progetti",
  "dezain-korekushon",
  "designs-colecoes",
  "dizain-kollektsii",
  "tasarım-koleksiyonlar",
  "shèjì-xìliè",
]);
// `/en/creations/<slug>` redirects to the model, but these are lists of them.
const CREATIONS_PAGES = new Set(["latest", "popular", "selected", "trending", "best-sellers", "random", "mine", "new"]);
const SLUG = /^[a-z0-9][a-z0-9_-]*$/i;
const LOCALE = /^[a-z]{2}$/;
const NICK = /^[\w.-]+$/;

/** A model page: `/<locale>/3d-model/<category>/<slug>`, in any of the site's languages, or `/<locale>/creations/<slug>`.
 *  A model is known by its slug, the only id its links carry. */
export function parseCults3dModelUrl(url: string): { slug: string } | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const parts = segments(parsed);
  if (!LOCALE.test(parts[0] ?? "")) return null;
  if (MODEL_WORDS.has(parts[1]) && parts.length >= 4 && SLUG.test(parts[3])) return { slug: parts[3] };
  if (parts[1] === "creations" && parts.length === 3 && SLUG.test(parts[2]) && !CREATIONS_PAGES.has(parts[2])) {
    return { slug: parts[2] };
  }
  return null;
}

/** The site redirects this to the model's page, whatever its category. */
export function cults3dModelUrl(slug: string): string {
  return `${SITE_ORIGIN}/en/creations/${encodeURIComponent(slug)}`;
}

/** A user's likes: `/<locale>/users/<nick>/likes`, in any of the site's languages. */
export function parseCults3dLikesUrl(url: string): { nick: string } | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  // Nicknames keep their case, so they're read from the path as it is.
  const raw = parsed.pathname.split("/").filter(Boolean);
  const parts = segments(parsed);
  if (parts.length !== 4 || !LOCALE.test(parts[0]) || !LIKES_WORDS.has(parts[3])) return null;
  const nick = decodeURIComponent(raw[2]);
  return NICK.test(nick) ? { nick } : null;
}

export function cults3dLikesUrl(nick: string): string {
  return `${SITE_ORIGIN}/en/users/${encodeURIComponent(nick)}/likes`;
}

/** A sync of a user's likes is known by this, as Thingiverse's are; nicknames aren't case-sensitive. */
export function cults3dLikesKey(nick: string): string {
  return `likes:${nick.toLowerCase()}`;
}

/** A printlist, as the site calls collections in its API ("design collections" on its pages):
 *  `/<locale>/design-collections/<nick>/<slug>`. `key`, what a sync knows it by, is "<nick>/<slug>" in lower case. */
export function parseCults3dPrintlistUrl(url: string): { nick: string; slug: string; key: string; url: string } | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const raw = parsed.pathname.split("/").filter(Boolean);
  const parts = segments(parsed);
  if (parts.length !== 4 || !LOCALE.test(parts[0]) || !PRINTLIST_WORDS.has(parts[1])) return null;
  const nick = decodeURIComponent(raw[2]);
  const slug = decodeURIComponent(raw[3]);
  if (!NICK.test(nick) || !slug) return null;
  return { nick, slug, key: `${nick}/${slug}`.toLowerCase(), url: cults3dPrintlistUrl(nick, slug) };
}

export function cults3dPrintlistUrl(nick: string, slug: string): string {
  return `${SITE_ORIGIN}/en/design-collections/${encodeURIComponent(nick)}/${encodeURIComponent(slug)}`;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseCults3dModelUrl(url);
    return model && { externalId: model.slug, requestedProfileId: null };
  },
  parseList(url): ListLink | null {
    const printlist = parseCults3dPrintlistUrl(url);
    if (printlist) return { kind: "collection", externalId: printlist.key, url: printlist.url };
    const likes = parseCults3dLikesUrl(url);
    if (!likes) return null;
    // Anyone's, as on Thingiverse: Cults3D's API shows them to any key.
    return {
      kind: "likes",
      externalId: cults3dLikesKey(likes.nick),
      url: cults3dLikesUrl(likes.nick),
      likesOf: likes.nick,
    };
  },
  modelUrl: cults3dModelUrl,
};
