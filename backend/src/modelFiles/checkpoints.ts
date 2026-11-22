// A named point in storage code where a test can pause an operation or make it fail (backend/tests/harness). With no
// hook, as in production, a checkpoint does nothing and returns at once. Imports nothing, so the tests' setup file can
// load it without fixing the storage folder.

/** What a checkpoint tells the test's hook: the file it's about to touch, when there is one. */
export type CheckpointDetail = { path?: string };
export type CheckpointHook = (name: string, detail: CheckpointDetail) => Promise<void> | void;

let hook: CheckpointHook | null = null;

/** Reached before a step a test may want to pause or fail. Returns at once unless the test's hook pauses here, so the
 *  order of things is the same with and without a test watching. */
export function checkpoint(name: string, detail: CheckpointDetail = {}): Promise<void> | void {
  return hook?.(name, detail);
}

/** A checkpoint for a step that can't wait: a fault comes through, and a pause asked for here is a mistake in the test. */
export function checkpointSync(name: string, detail: CheckpointDetail = {}): void {
  const waiting = hook?.(name, detail);
  if (waiting) throw new Error(`${name} is reached synchronously: it can't be paused`);
}

/** The harness's alone (tests/harness/lifecycle.ts), which sets it before each test and clears it after. */
export function setCheckpointHookForTest(next: CheckpointHook | null): void {
  if (next && !process.env.VITEST) throw new Error("Checkpoints are a test seam");
  hook = next;
}
