import type { Role } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: Role;
      /** Signed in with the user's API token rather than a session. */
      viaApiToken?: boolean;
      /** When the person behind this session last actually signed in (not refreshed). */
      signedInAt?: Date;
      /** The browser session the access token came from, when it came from one. */
      sessionId?: string;
      /** A session token from an `/api/t/<token>/...` link, which `pathToken` strips from the URL. */
      pathToken?: string;
    }
  }
}
