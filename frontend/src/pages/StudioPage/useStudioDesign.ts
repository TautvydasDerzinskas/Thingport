import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { studioApi, studioErrorMessage, type StudioDesign } from "../../api/studio";
import { UnauthorizedError } from "../../api/client";
import {
  applyCommand,
  CommandError,
  studioCommand,
  type StudioCommandArgs,
  type StudioCommandName,
} from "../../studio/commands";
import { fontsLoadedFor, loadFontsFor } from "./studioFonts";

// The open design, and the one way the page changes it: run(), with the same commands an assistant's MCP tools run.
// There's deliberately no setter for the document, so a button can't change a design in a way an AI couldn't.

// How often an open design asks whether something else, an assistant, changed it.
const POLL_MS = 2000;

export type RunCommand = <N extends StudioCommandName>(
  name: N,
  args: StudioCommandArgs<N>,
  options?: { waitForSave?: boolean },
) => Promise<string[] | null>;

export function useStudioDesign(
  designId: string | null,
  { onError, onUnauthorized }: { onError: (message: string) => void; onUnauthorized?: () => void },
) {
  const [design, setDesign] = useState<StudioDesign | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const active = useRef<{ id: string } | null>(null);
  // The design as run() sees it, which a command updates before the page renders again.
  const current = useRef<StudioDesign | null>(null);
  const showDesign = useCallback((next: StudioDesign | null) => {
    current.current = next;
    setDesign(next);
  }, []);
  // Commands go to the server one after another, in the order they were run.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef(0);
  const handlers = useRef({ onError, onUnauthorized });
  useEffect(() => {
    handlers.current = { onError, onUnauthorized };
  }, [onError, onUnauthorized]);

  const fail = useCallback((error: unknown) => {
    if (error instanceof UnauthorizedError) handlers.current.onUnauthorized?.();
    else handlers.current.onError(error instanceof Error ? error.message : String(error));
  }, []);

  const reload = useCallback(
    async (id: string) => {
      const scope = active.current;
      if (scope?.id !== id) return;
      try {
        const loaded = await studioApi.get(id);
        // Its text shows in its fonts, so they come in first; one that won't load leaves its text undrawn.
        await loadFontsFor(loaded.document).catch(() => undefined);
        if (active.current !== scope || (current.current && loaded.version < current.current.version)) return;
        showDesign(loaded);
        setLoadFailed(false);
      } catch (error) {
        if (active.current !== scope) return;
        setLoadFailed(true);
        fail(error);
      }
    },
    [fail, showDesign],
  );

  useLayoutEffect(() => {
    active.current = designId ? { id: designId } : null;
    showDesign(null);
    setLoadFailed(false);
    if (designId) void reload(designId);
    return () => {
      active.current = null;
    };
  }, [designId, reload, showDesign]);

  // Picks up what an assistant did while the page is open. Not while a command of the page's own is on its way, whose
  // answer brings the design back anyway.
  useEffect(() => {
    if (!designId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || inFlight.current > 0) return;
      studioApi
        .version(designId)
        .then(({ version }) => {
          if (inFlight.current === 0 && current.current?.id === designId && version !== current.current.version)
            void reload(designId);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [designId, reload]);

  const run: RunCommand = useCallback(
    async (name, args, options) => {
      const scope = active.current;
      const open = current.current;
      if (!open || open.id !== designId || open.id !== scope?.id) return null;
      const fontsReady = fontsLoadedFor(args);
      const send = (): Promise<string[] | null> => {
        inFlight.current += 1;
        const sent = queue.current.then(async () => {
          try {
            // Reserve the command's place even while fetching the font needed to draw its text.
            if (!fontsReady) await loadFontsFor(args);
            const result = await studioApi.run(open.id, name, args);
            if (active.current !== scope) return null;
            showDesign(result.design);
            return result.created;
          } catch (error) {
            if (active.current === scope) {
              fail(error);
              if (inFlight.current === 1) await reload(open.id);
            }
            return null;
          } finally {
            inFlight.current -= 1;
          }
        });
        queue.current = sent.catch(() => undefined);
        return sent;
      };
      // An earlier command can consume the next feature or plate ID. Use the server's IDs until the queue settles.
      if (inFlight.current > 0 || !fontsReady || options?.waitForSave || !studioCommand(name)?.apply) return send();
      try {
        const outcome = applyCommand(open.document, name, args);
        const next = { ...open, document: outcome.document, can_undo: true, can_redo: false };
        showDesign(next);
        void send();
        return outcome.created;
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        handlers.current.onError(studioErrorMessage(error.message, error.code));
        return null;
      }
    },
    [designId, fail, reload, showDesign],
  );

  const waitForSaves = useCallback(async (id: string) => {
    const scope = active.current;
    if (scope?.id !== id) return null;
    while (active.current === scope) {
      const pending = queue.current;
      await pending;
      if (active.current !== scope) return null;
      if (pending === queue.current) return current.current;
    }
    return null;
  }, []);

  return { design, loadFailed, run, reload, waitForSaves };
}
