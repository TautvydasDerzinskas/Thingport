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
    }
  }
}
