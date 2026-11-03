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

// The open design, and the one way the page changes it: run(), with the same commands an assistant's MCP tools run.
// There's deliberately no setter for the document, so a button can't change a design in a way an AI couldn't.

// How often an open design asks whether something else, an assistant, changed it.
const POLL_MS = 2000;

export type RunCommand = <N extends StudioCommandName>(name: N, args: StudioCommandArgs<N>) => Promise<string[] | null>;

export function useStudioDesign(
  designId: string | null,
  { onError, onUnauthorized }: { onError: (message: string) => void; onUnauthorized?: () => void },
) {
  const [design, setDesign] = useState<StudioDesign | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // The design as run() sees it, which a command updates before the page renders again.
  const current = useRef<StudioDesign | null>(null);
  useEffect(() => {
    current.current = design;
  }, [design]);
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
        if (current.current === null || current.current.id === id) setDesign(loaded);
        setLoadFailed(false);
      } catch (error) {
        setLoadFailed(true);
        fail(error);
      }
    },
    [fail],
  );

  useEffect(() => {
    setDesign(null);
    current.current = null;
    if (designId) void reload(designId);
  }, [designId, reload]);

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
    async (name, args) => {
      const open = current.current;
      if (!open) return null;
      const send = async (): Promise<string[] | null> => {
        inFlight.current += 1;
        const sent = queue.current.then(() => studioApi.run(open.id, name, args));
        queue.current = sent.catch(() => undefined);
        try {
          const result = await sent;
          inFlight.current -= 1;
          // With more of the page's commands still on their way, the newer local state stands until the last answer.
          if (inFlight.current === 0 && current.current?.id === result.design.id) setDesign(result.design);
          return result.created;
        } catch (error) {
          inFlight.current -= 1;
          fail(error);
          if (inFlight.current === 0) void reload(open.id);
          return null;
        }
      };
      // A change to the feature tree shows at once, and what it made can be selected at once; the server's answer
      // then takes over. Undo, redo and the design's name wait for the server, which keeps the history.
      if (!studioCommand(name)?.apply) return send();
      try {
        const outcome = applyCommand(open.document, name, args);
        const next = { ...open, document: outcome.document, can_undo: true, can_redo: false };
        current.current = next;
        setDesign(next);
        void send();
        return outcome.created;
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        handlers.current.onError(error.message);
        return null;
      }
    },
    [fail, reload],
  );

  return { design, loadFailed, run, reload };
}
