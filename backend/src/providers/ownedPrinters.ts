// The printers a user's accounts have, for Configuration > Printer's Find my printers (services/userPrinters.ts):
// each provider whose printer maker's cloud lists them builds its `ownedPrinters` with these.

import { brandPrinterForName } from "../printers/catalogue";
import type { OwnedPrinter, ProviderOwnedPrinters } from "./types";

/** The catalogue's printers of a brand that a site's printers are, each given by the names its model goes by, the
 *  first one the catalogue knows counting; one it doesn't know is left out. */
export function brandOwnedPrinters(brandId: string, printers: readonly (readonly string[])[]): OwnedPrinter[] {
  return printers.flatMap((names) => {
    for (const name of names) {
      const hit = brandPrinterForName(brandId, name);
      if (hit) return [{ printerId: hit.printer.id, nozzle: hit.nozzle ? Number(hit.nozzle) : null }];
    }
    return [];
  });
}

/** A provider's `ownedPrinters` from its sign-in and its call: `isRejection` tells the error it throws for a sign-in
 *  turned down, which `markRejected` then remembers. */
export function ownedPrintersOf<A>(options: {
  connected(userId: string): Promise<boolean>;
  auth(userId: string): Promise<A | null>;
  list(auth: A): Promise<OwnedPrinter[] | null>;
  isRejection(err: unknown): boolean;
  markRejected(userId: string, auth: A): Promise<void>;
}): ProviderOwnedPrinters {
  return {
    connected: options.connected,
    async read(userId) {
      const auth = await options.auth(userId);
      if (auth === null) return "signed-out";
      try {
        return await options.list(auth);
      } catch (err) {
        if (!options.isRejection(err)) throw err;
        await options.markRejected(userId, auth);
        return "rejected";
      }
    },
  };
}
