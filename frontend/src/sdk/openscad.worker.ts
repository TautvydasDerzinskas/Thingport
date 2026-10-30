/// <reference lib="webworker" />
// The OpenSCAD engine, on its own thread.
//
// It takes one call at a time and answers it. The geometry comes back as transferable buffers rather than a
// copy, so handing a model of three hundred thousand triangles across costs microseconds and the page it is
// going to never stops painting.

import { scadParameters, scadRender } from "./openscadEngine";
import type { ScadRender, ScadRenderOptions } from "./openscadEngine";

type Call =
  | { id: number; kind: "parameters"; source: string }
  | { id: number; kind: "render"; source: string; options: ScadRenderOptions };

/** The buffers worth moving rather than copying: everything big a render hands back. */
function movable(result: ScadRender): Transferable[] {
  const out: Transferable[] = [];
  const take = (view?: { buffer: ArrayBufferLike }) => {
    if (view?.buffer instanceof ArrayBuffer && !out.includes(view.buffer)) out.push(view.buffer);
  };
  take(result.bytes);
  take(result.mesh?.vertices);
  take(result.mesh?.triangles);
  return out;
}

self.addEventListener("message", (event: MessageEvent<Call>) => {
  const call = event.data;
  void (async () => {
    try {
      if (call.kind === "parameters") {
        // A worker's postMessage takes a transfer list, not a target origin: passing one would be
        // read as the transfer list and throw.
        // eslint-disable-next-line unicorn/require-post-message-target-origin
        self.postMessage({ id: call.id, ok: true, value: await scadParameters(call.source) });
        return;
      }
      const value = await scadRender(call.source, call.options);
      // A worker's postMessage takes a transfer list, not a target origin: passing one would be
      // read as the transfer list and throw.
      // eslint-disable-next-line unicorn/require-post-message-target-origin
      self.postMessage({ id: call.id, ok: true, value }, movable(value));
    } catch (err) {
      // An Error doesn't survive the trip in every browser, so what matters about it is sent as plain text.
      // A worker's postMessage takes a transfer list, not a target origin: passing one would be
      // read as the transfer list and throw.
      // eslint-disable-next-line unicorn/require-post-message-target-origin
      self.postMessage({ id: call.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
});
