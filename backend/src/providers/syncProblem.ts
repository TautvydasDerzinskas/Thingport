// Why a synced list can't be checked, which services/collectionSyncRunner.ts keeps on the sync and tells the user.

/** `error` is kept on the sync; `reason` and `fix` make the notification ("… won't sync until <fix>"). */
export type SyncProblem = { error: string; reason: string; fix: string };

/** A listing that can't be read for this one sync, which waits for it alone (likes that need a sign-in the user
 *  hasn't given, on a provider whose collections read without one). */
export class SyncHeldError extends Error {
  constructor(readonly problem: SyncProblem) {
    super(problem.error);
  }
}
