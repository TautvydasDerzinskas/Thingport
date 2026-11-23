import os from "node:os";
import { setCheckpointHookForTest } from "../../src/modelFiles/checkpoints";
import { DOOR_CHECKPOINTS, type DoorCheckpoint } from "../../src/modelFiles/storageFs";

// One test's faults, pauses and expectations, behind the checkpoint hook (src/modelFiles/checkpoints.ts). setup.ts
// installs it before each test and checks it after: a fault, pause or `reached` never met fails the test, and an
// operation still parked at a pause is undone. Imports only the two src files, so setup.ts can load it.

export type ErrnoCode = keyof typeof os.constants.errno;

/** What an operation still parked at a pause rejects with when the test ends. */
export class HarnessAborted extends Error {}

type Fault = { call: string; nth: number; code: ErrnoCode; path?: string; seen: number; fired: boolean };
type Pause = {
  name: string;
  nth: number;
  seen: number;
  reached: boolean;
  parked: boolean;
  wait: Promise<void>;
  release: () => void;
  abort: (err: Error) => void;
  onReached: () => void;
};

let faultList: Fault[] = [];
let pauses: Pause[] = [];
let expected = new Map<string, boolean>();
let counts = new Map<string, number>();
let tracked: Promise<unknown>[] = [];
let ending = false;

function known(name: string): void {
  if (!DOOR_CHECKPOINTS.has(name)) throw new Error(`No checkpoint is called ${name}`);
}

/** An error as Node reports one from the disk: its code, negative errno, system call and path. */
function errnoError(code: ErrnoCode, name: string, path: string | undefined): NodeJS.ErrnoException {
  const syscall = name.startsWith("fileState:")
    ? "stat"
    : name.startsWith("open:")
      ? "open"
      : name.startsWith("remove:")
        ? "unlink"
        : "fstat";
  const err = new Error(`${code}: put there by the test, ${syscall} '${path ?? ""}'`) as NodeJS.ErrnoException;
  err.code = code;
  err.errno = -os.constants.errno[code];
  err.syscall = syscall;
  if (path) err.path = path;
  return err;
}

function hook(name: string, detail: { path?: string }): Promise<void> | void {
  known(name);
  counts.set(name, (counts.get(name) ?? 0) + 1);
  if (expected.has(name)) expected.set(name, true);
  // Every fault for this call counts it before one fires, so faults at its 1st and 2nd calls fire at calls 1 and 2.
  let due: Fault | undefined;
  for (const fault of faultList) {
    if (fault.fired || fault.call !== name || (fault.path !== undefined && fault.path !== detail.path)) continue;
    fault.seen += 1;
    if (fault.seen === fault.nth) due ??= fault;
  }
  if (due) {
    due.fired = true;
    throw errnoError(due.code, name, detail.path);
  }
  // As with faults, every pause for this call counts it before one parks.
  let parkAt: Pause | undefined;
  for (const pause of pauses) {
    if (pause.reached || pause.name !== name) continue;
    pause.seen += 1;
    if (pause.seen === pause.nth) parkAt ??= pause;
  }
  if (parkAt) {
    // Reached while the test is ending, nothing would ever release it.
    if (ending) throw new HarnessAborted(`The test ended before ${name} #${parkAt.nth} was reached`);
    parkAt.reached = true;
    parkAt.parked = true;
    parkAt.onReached();
    return parkAt.wait;
  }
}

export const faults = {
  /** The `nth` call (from 1, counted from now) to reach `call` fails with `code` before the disk is touched, once.
   *  With `path`, only calls for that file count. */
  at(call: DoorCheckpoint, nth: number, code: ErrnoCode, where?: { path: string }): void {
    known(call);
    if (!(code in os.constants.errno)) throw new Error(`No error is called ${code}`);
    faultList.push({ call, nth, code, path: where?.path, seen: 0, fired: false });
  },
};

export type Gate = {
  /** Resolves once an operation is parked here; rejects if `op` settles first, so a missed checkpoint fails at once. */
  reachedBy(op: Promise<unknown>): Promise<void>;
  /** Lets the parked operation go on. */
  release(): void;
};

/** The `nth` call to reach `name` waits there until released. */
export function pauseAt(name: DoorCheckpoint, nth = 1): Gate {
  known(name);
  let release!: () => void;
  let abort!: (err: Error) => void;
  const wait = new Promise<void>((resolve, reject) => {
    release = resolve;
    abort = reject;
  });
  let onReached!: () => void;
  const hit = new Promise<void>((resolve) => {
    onReached = resolve;
  });
  const pause: Pause = { name, nth, seen: 0, reached: false, parked: false, wait, release, abort, onReached };
  pauses.push(pause);
  return {
    reachedBy: (op) =>
      new Promise<void>((resolve, reject) => {
        void hit.then(resolve);
        const early = (how: string) => () => reject(new Error(`The operation ${how} before reaching ${name} #${nth}`));
        op.then(early("settled"), early("failed"));
      }),
    release() {
      pause.parked = false;
      release();
    },
  };
}

/** Fails the test, when it ends, unless `name` is reached at least once from now. */
export function reached(name: DoorCheckpoint): void {
  known(name);
  expected.set(name, false);
}

/** How often `name` was reached in this test. */
export function hits(name: DoorCheckpoint): number {
  known(name);
  return counts.get(name) ?? 0;
}

/** Tracks `op`, so the test's end waits for it to settle. */
export function track<T>(op: Promise<T>): Promise<T> {
  tracked.push(op.catch(() => undefined));
  return op;
}

function reset(): void {
  ending = false;
  faultList = [];
  pauses = [];
  expected = new Map();
  counts = new Map();
  tracked = [];
}

/** Before each test: the hook, with nothing asked of it. */
export function beginTest(): void {
  reset();
  setCheckpointHookForTest(hook);
}

/** After each test: undoes every operation still parked (its checkpoint rejects with HarnessAborted), waits for every
 *  tracked one, removes the hook, and fails naming each fault, pause and `reached` never met. */
export async function endTest(): Promise<void> {
  const problems: string[] = [];
  ending = true;
  for (const pause of pauses) {
    if (!pause.parked) continue;
    problems.push(`left parked: ${pause.name} #${pause.nth}`);
    pause.parked = false;
    pause.abort(new HarnessAborted(`The test ended with an operation parked at ${pause.name}`));
  }
  await Promise.all(tracked);
  for (const fault of faultList) {
    if (!fault.fired) problems.push(`never reached: ${fault.call} #${fault.nth} ${fault.code}`);
  }
  for (const pause of pauses)
    if (!pause.reached) problems.push(`never reached: a pause at ${pause.name} #${pause.nth}`);
  for (const [name, met] of expected) if (!met) problems.push(`never reached: ${name}`);
  setCheckpointHookForTest(null);
  reset();
  if (problems.length) throw new Error(`The storage harness's expectations weren't met:\n${problems.join("\n")}`);
}
