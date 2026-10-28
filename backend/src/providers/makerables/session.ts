import {
  connectionState,
  readConnection,
  rejectConnection,
  usableSecret,
  writeConnection,
  type ConnectionState,
} from "../connections";
import { createLogger } from "../../logger";
import manifest from "./manifest.generated";
import { MakerablesAuthError, mintMakerablesToken, type MakerablesAccount } from "./api";

// Per-user: the Makerables sign-in, which only the saved projects need. The site signs in with Auth0's Next.js SDK,
// which keeps the whole session -- the access token among it -- in a `__session` cookie, split across `__session__0`,
// `__session__1`, … when it outgrows one. The cookie is what's kept here; the Bearer token the API takes is minted
// from it by the site's own /auth/access-token, as its pages do on every load, and held in memory until it runs out.
// Thingport Grab reads the cookies from a signed-in makerables.com page and sends each new set; a pasted Cookie
// header, or a signed-in request's copied headers, works too. Who it is (accountId) is their Makerables user id,
// which their saved projects are read by.

const ID = manifest.id;
const SESSION_PREFIX = manifest.sessionCookies.session;
const log = createLogger(ID);

// Minted again a little before it runs out, so a long listing never starts with a token about to.
const RENEW_BEFORE_MS = 10 * 60 * 1000;

type Secret = { cookie: string };

// Its chunks are base64url of encrypted JSON, with the dots of a JWE between them.
const COOKIE_VALUE = String.raw`[\w%=+/.~-]{16,8192}`;
const SESSION = new RegExp(
  String.raw`(?:^|[;\s])(${SESSION_PREFIX}(?:__\d{1,2})?)="?(${COOKIE_VALUE})"?(?=[;\s]|$)`,
  "g",
);

/** Which chunk of the split cookie a name is; -1 for the unsplit one, which comes first on its own. */
const chunkIndex = (name: string) => Number(name.match(/__(\d{1,2})$/)?.[1] ?? -1);

/** The sign-in in a Cookie header, or a signed-in request's copied headers, as the Cookie header it's sent back as:
 *  its `__session` chunks in the order they're numbered. Null when there's none. */
export function normalizeMakerablesSession(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const chunks = [...text.matchAll(SESSION)].map(([, name, value]) => ({ name, value }));
  if (!chunks.length) return null;
  return chunks
    .toSorted((a, b) => chunkIndex(a.name) - chunkIndex(b.name))
    .map((chunk) => `${chunk.name}=${chunk.value}`)
    .join("; ");
}

/** The user's sign-in cookie, until Makerables turns it down; null without one. */
export async function getUserMakerablesCookie(userId: string): Promise<string | null> {
  return usableSecret<Secret>(await readConnection<Secret>(userId, ID))?.cookie ?? null;
}

/** A new sign-in clears an earlier rejection. Who it is, where a check said so, is kept on disconnect; one that was
 *  never checked forgets the last one's, as it may be someone else's. */
export async function setUserMakerablesSession(
  userId: string,
  cookie: string | null,
  account: MakerablesAccount | null = null,
): Promise<boolean> {
  tokens.delete(userId);
  await writeConnection<Secret>(userId, ID, {
    secret: cookie ? { cookie } : null,
    expiresAt: null,
    rejectedAt: null,
    ...(account
      ? { accountId: account.userId, accountName: account.name }
      : cookie
        ? { accountId: null, accountName: null }
        : {}),
  });
  return Boolean(cookie);
}

export async function markMakerablesSessionRejected(userId: string): Promise<void> {
  tokens.delete(userId);
  await rejectConnection(userId, ID);
}

export async function getMakerablesConnection(
  userId: string,
): Promise<{ state: ConnectionState; account: MakerablesAccount | null }> {
  const connection = await readConnection(userId, ID);
  const accountId = connection?.accountId ?? null;
  return {
    state: connectionState(connection),
    account: accountId ? { userId: accountId, name: connection?.accountName ?? null } : null,
  };
}

/** The Makerables account whose saved projects are theirs, with the cookie to read them by; null when they haven't
 *  connected it, or it was turned down, or no check has said who it is yet. */
export async function getUserMakerablesAccount(
  userId: string,
): Promise<{ account: MakerablesAccount; cookie: string } | null> {
  const connection = await readConnection<Secret>(userId, ID);
  const cookie = usableSecret<Secret>(connection)?.cookie;
  const accountId = connection?.accountId;
  return cookie && accountId ? { account: { userId: accountId, name: connection.accountName }, cookie } : null;
}

// The minted token, per Thingport user: it is the same one the browser holds, good for a day, and minting it again
// costs a call, so it's kept until it runs out. In memory only -- a restart just mints another.
const tokens = new Map<string, { token: string; expiresAt: Date | null }>();
// One mint at a time per user, however many calls ask at once.
const minting = new Map<string, Promise<string>>();

const stillGood = (expiresAt: Date | null) => !expiresAt || expiresAt.getTime() - Date.now() > RENEW_BEFORE_MS;

/** A token for the user's cookie, minted when the one in hand has run out. A new session cookie handed back with it
 *  is kept, so the next mint has the current one. Throws MakerablesAuthError for a cookie it won't take. */
export async function makerablesToken(userId: string, cookie: string): Promise<string> {
  const held = tokens.get(userId);
  if (held && stillGood(held.expiresAt)) return held.token;
  const running = minting.get(userId);
  if (running) return running;
  const run = (async () => {
    try {
      const minted = await mintMakerablesToken(cookie);
      tokens.set(userId, { token: minted.token, expiresAt: minted.expiresAt });
      if (minted.cookie && minted.cookie !== cookie) {
        await writeConnection<Secret>(userId, ID, { secret: { cookie: minted.cookie } });
        log.info("session cookie renewed", { user: userId });
      }
      return minted.token;
    } catch (err) {
      if (err instanceof MakerablesAuthError) {
        log.warn("sign-in turned down", { user: userId });
        await markMakerablesSessionRejected(userId);
      }
      throw err;
    }
  })().finally(() => minting.delete(userId));
  minting.set(userId, run);
  return run;
}

/** Shown wherever the saved projects need the user's sign-in, and there's none. */
export const MAKERABLES_CONNECT =
  "Makerables shows saved projects to their owner only: visit makerables.com signed in with Thingport Grab, " +
  "or connect it in Configuration > Providers.";
