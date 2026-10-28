// What a tool calls to run OpenSCAD.
//
// The engine itself is in openscadEngine.ts and runs in workers: a render holds its thread until it is done,
// and on a real generator that is seconds. Held on the thread drawing the page, the window stops responding --
// no progress bar moves, no Cancel is noticed, and the browser offers to close the tab.
//
// There is a small pool of them rather than one, because the parts of a plan don't depend on each other: a wall
// of a dozen plates is a dozen renders that can go at once, and a machine with cores to spare finishes in a
// fraction of the time. The pool is deliberately smaller than the machine, so the browser keeps a core to draw
// with and the page stays smooth while it all happens.

import { SCAD_LIBRARIES } from "./scadLibraries";
import type { ScadParameters, ScadRender, ScadRenderOptions, ScadFormat, ScadParameter } from "./openscadEngine";

export type { ScadParameters, ScadRender, ScadRenderOptions, ScadFormat, ScadParameter };
export { SCAD_LIBRARIES };

/**
 * How many renders may run at once.
 *
 * One fewer than the machine has, so there is always a core left for the page, and never more than four: each
 * worker holds its own copy of the engine, and past a handful the memory costs more than the time saves.
 */
export const SCAD_CONCURRENCY = Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 4) - 1));

type Answer = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };
type Job = {
  message: Record<string, unknown>;
  signal?: AbortSignal;
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
};
type Slot = { worker: Worker; job: (Job & { id: number }) | null };

const pool: Slot[] = [];
const queue: Job[] = [];
let nextId = 1;

/** The reason everything waiting on a worker is told, when that worker goes away under it. */
function fail(slot: Slot, reason: Error): void {
  slot.job?.reject(reason);
  slot.job = null;
}

function hire(): Slot {
  const slot: Slot = {
    worker: new Worker(new URL("./openscad.worker.ts", import.meta.url), { type: "module" }),
    job: null,
  };
  slot.worker.addEventListener("message", (event: MessageEvent<Answer>) => {
    const answer = event.data;
    if (!slot.job || slot.job.id !== answer.id) return;
    const job = slot.job;
    slot.job = null;
    if (answer.ok) job.resolve(answer.value as never);
    else job.reject(new Error(answer.error));
    take(slot);
  });
  slot.worker.addEventListener("error", (event) => {
    fail(slot, new Error(event.message || "The OpenSCAD engine stopped"));
    retire(slot);
  });
  pool.push(slot);
  return slot;
}

/** A worker that is gone, or has to go: the next call hires a fresh one in its place. */
function retire(slot: Slot): void {
  slot.worker.terminate();
  const at = pool.indexOf(slot);
  if (at >= 0) pool.splice(at, 1);
  // Whatever was waiting its turn still can be, on whoever is free.
  for (const free of pool) take(free);
  if (queue.length && pool.length < SCAD_CONCURRENCY) take(hire());
}

/** Gives a waiting job to a free worker, if there is one of each. */
function take(slot: Slot): void {
  if (slot.job) return;
  const job = queue.shift();
  if (!job) return;
  if (job.signal?.aborted) {
    job.reject(new Error("cancelled"));
    take(slot);
    return;
  }
  const id = nextId++;
  slot.job = { ...job, id };
  // Stopping a render means stopping the thread it is on: the engine is inside a call that does not come back
  // until it is finished, so the only way to be rid of it at once is to let the worker go.
  job.signal?.addEventListener(
    "abort",
    () => {
      if (slot.job?.id !== id) return;
      fail(slot, new Error("cancelled"));
      retire(slot);
    },
    { once: true },
  );
  // A worker's postMessage takes a transfer list, not a target origin: passing one would be
  // read as the transfer list and throw.
  // eslint-disable-next-line unicorn/require-post-message-target-origin
  slot.worker.postMessage({ ...job.message, id });
}

function ask<T>(message: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("cancelled"));
      return;
    }
    queue.push({ message, signal, resolve: resolve as (value: never) => void, reject });
    const free = pool.find((slot) => !slot.job);
    if (free) take(free);
    else if (pool.length < SCAD_CONCURRENCY) take(hire());
  });
}

/** What parameters a script offers, as OpenSCAD's own customizer describes them. */
export function scadParameters(source: string): Promise<ScadParameters> {
  return ask<ScadParameters>({ kind: "parameters", source });
}

/**
 * The model a script makes of a given set of parameters.
 *
 * Given a `signal`, cancelling really does stop it: the worker running it is let go there and then, rather
 * than the call being left to finish into nothing.
 */
export function scadRender(source: string, options: ScadRenderOptions = {}): Promise<ScadRender> {
  const { signal, ...rest } = options;
  return ask<ScadRender>({ kind: "render", source, options: rest }, signal);
}
