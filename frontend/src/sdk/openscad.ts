// What a tool calls to run OpenSCAD.
//
// The engine itself is in openscadEngine.ts and runs in a worker: a render holds its thread until it is done,
// and on a real generator that is seconds. Held on the thread drawing the page, the window stops responding --
// no progress bar moves, no Cancel is noticed, and the browser offers to close the tab. Held on a worker's, the
// page carries on as normal.
//
// The calls are the same shape they always were, so nothing that used this has to change.

import { SCAD_LIBRARIES } from "./scadLibraries";
import type { ScadParameters, ScadRender, ScadRenderOptions, ScadFormat, ScadParameter } from "./openscadEngine";

export type { ScadParameters, ScadRender, ScadRenderOptions, ScadFormat, ScadParameter };
export { SCAD_LIBRARIES };

type Answer = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (value: never) => void; reject: (reason: Error) => void }>();

/** One worker for the tab, started the first time something is asked of it. */
function engine(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./openscad.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<Answer>) => {
    const answer = event.data;
    const pending = waiting.get(answer.id);
    if (!pending) return;
    waiting.delete(answer.id);
    if (answer.ok) pending.resolve(answer.value as never);
    else pending.reject(new Error(answer.error));
  });
  worker.addEventListener("error", (event) => {
    // The worker is gone, so everything waiting on it is too; the next call starts a fresh one.
    const failed = new Error(event.message || "The OpenSCAD engine stopped");
    for (const pending of waiting.values()) pending.reject(failed);
    waiting.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

function ask<T>(message: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (value: never) => void, reject });
    // A worker's postMessage takes a transfer list, not a target origin: passing one would be
    // read as the transfer list and throw.
    // eslint-disable-next-line unicorn/require-post-message-target-origin
    engine().postMessage({ ...message, id });
  });
}

/** What parameters a script offers, as OpenSCAD's own customizer describes them. */
export function scadParameters(source: string): Promise<ScadParameters> {
  return ask<ScadParameters>({ kind: "parameters", source });
}

/** The model a script makes of a given set of parameters. */
export function scadRender(source: string, options: ScadRenderOptions = {}): Promise<ScadRender> {
  return ask<ScadRender>({ kind: "render", source, options });
}
