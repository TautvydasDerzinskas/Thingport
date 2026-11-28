import { PrismaClient } from "@prisma/client";
import { vi } from "vitest";

/** How a disputed transaction ends: its work rolled back, committed with the answer lost, or never run at all. */
export type Dispute = { caller: string; outcome: "rolled back" | "commit unanswered" | "fails" };

/** The function that called $transaction, by name: the first frame past this helper and vitest's spy. */
function openerOf(stack: string): string | undefined {
  const frame = stack
    .split("\n")
    .slice(1)
    .find((line) => !line.includes("/tests/helpers/transactions.ts") && !line.includes("node_modules"));
  return frame ? /^\s*at (?:async )?(\S+) \(/.exec(frame)?.[1].split(".").pop() : undefined;
}

/** Ends the first transaction each named function opens, in order, as its dispute says, and leaves every other
 *  transaction alone: background work in the same process opens transactions too, which a plain once-mock can catch
 *  instead. A caller is matched by the name of the function that opens the transaction itself, not one further up.
 *  Restore it when done; `unconsumed()` names the callers whose dispute never ran. */
export function disputeTransactions(...disputes: Dispute[]) {
  const transaction = PrismaClient.prototype.$transaction;
  const left = [...disputes];
  const spy = vi.spyOn(PrismaClient.prototype, "$transaction").mockImplementation(function (
    this: PrismaClient,
    ...args: unknown[]
  ) {
    const opener = openerOf(new Error().stack ?? "");
    const at = left.findIndex((dispute) => dispute.caller === opener);
    if (at === -1) return Reflect.apply(transaction, this, args);
    const [dispute] = left.splice(at, 1);
    if (dispute.outcome === "fails") return Promise.reject(new Error("The database went away"));
    if (dispute.outcome === "commit unanswered") {
      return (Reflect.apply(transaction, this, args) as Promise<unknown>).then(() => {
        throw new Error("Connection lost after COMMIT");
      });
    }
    const [callback, options] = args as [(tx: unknown) => Promise<unknown>, unknown];
    return Reflect.apply(transaction, this, [
      async (tx: unknown) => {
        await callback(tx);
        throw new Error("rolled back");
      },
      options,
    ]);
  } as never);
  return Object.assign(spy, { unconsumed: () => left.map((dispute) => dispute.caller) });
}
