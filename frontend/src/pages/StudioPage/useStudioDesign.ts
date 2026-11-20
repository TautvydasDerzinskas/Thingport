import { useCallback, useEffect, useRef, useState } from "react";
import { studioApi, type StudioDesign } from "../../api/studio";
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
  const activeId = useRef<string | null>(null);
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
      try {
        const loaded = await studioApi.get(id);
        // Its text shows in its fonts, so they come in first; one that won't load leaves its text undrawn.
        await loadFontsFor(loaded.document).catch(() => undefined);
        if (activeId.current !== id || (current.current && loaded.version < current.current.version)) return;
        showDesign(loaded);
        setLoadFailed(false);
      } catch (error) {
        if (activeId.current !== id) return;
        setLoadFailed(true);
        fail(error);
      }
    },
    [fail, showDesign],
  );

  useEffect(() => {
    activeId.current = designId;
    showDesign(null);
    if (designId) void reload(designId);
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
      // Text is drawn in its font, fetched the first time it's used.
      if (!fontsLoadedFor(args)) {
        try {
          await loadFontsFor(args);
        } catch (error) {
          fail(error);
          return null;
        }
      }
      const open = current.current;
      if (!open || open.id !== designId || open.id !== activeId.current) return null;
      const send = async (): Promise<string[] | null> => {
        inFlight.current += 1;
        const sent = queue.current.then(() => studioApi.run(open.id, name, args));
        queue.current = sent.catch(() => undefined);
        try {
          const result = await sent;
          if (activeId.current === result.design.id) showDesign(result.design);
          return result.created;
        } catch (error) {
          if (activeId.current === open.id) {
            fail(error);
            if (inFlight.current === 1) await reload(open.id);
          }
          return null;
        } finally {
          inFlight.current -= 1;
        }
      };
      // An earlier command can consume the next feature or plate ID. Use the server's IDs until the queue settles.
      if (inFlight.current > 0 || options?.waitForSave || !studioCommand(name)?.apply) return send();
      try {
        const outcome = applyCommand(open.document, name, args);
        const next = { ...open, document: outcome.document, can_undo: true, can_redo: false };
        showDesign(next);
        void send();
        return outcome.created;
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        handlers.current.onError(error.message);
        return null;
      }
    },
    [designId, fail, reload, showDesign],
  );

  return { design, loadFailed, run, reload };
}
