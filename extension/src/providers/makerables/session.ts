// The user's Makerables sign-in, which reads the projects they saved: Auth0's __session cookie, split across
// __session__0, __session__1, … when it outgrows one. Only a signed-in visitor has it at all -- a visitor gets
// nothing but a language cookie -- so it's sent on whenever it changes.

import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS } from "../index.generated";

const { makerables } = MANIFESTS;

/** Which chunk of the split cookie a name is; -1 for the unsplit one, which comes first on its own. */
const chunkIndex = (name: string) => Number(name.match(/__(\d{1,2})$/)?.[1] ?? -1);

export const makerablesSession: SessionSource = {
  async read() {
    const prefix = makerables.sessionCookies.session;
    // A lookup that fails throws on, so the sync takes it as unreadable rather than signed out.
    const cookies = await chrome.cookies.getAll({ url: makerables.site });
    const chunks = cookies.filter((cookie) => cookie.name.startsWith(prefix) && cookie.value);
    if (!chunks.length) return null;
    // Its chunks are numbered, and only in order do they make the session back up.
    const cookie = chunks
      .toSorted((a, b) => chunkIndex(a.name) - chunkIndex(b.name))
      .map((chunk) => `${chunk.name}=${chunk.value}`)
      .join("; ");
    // The cookie says nothing of whose it is; the instance asks the site.
    return { value: cookie, body: { session: cookie }, userId: null };
  },
  signedOut: { session: null },
};
