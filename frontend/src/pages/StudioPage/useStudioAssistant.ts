import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { UnauthorizedError } from "../../api/client";
import { studioApi, type StudioAiModels, type StudioAssistantThread, type StudioPicture } from "../../api/studio";
import { useConfirm } from "../../components/ConfirmProvider";

// Studio's assistant as the page holds it: which AI, the conversation about the open design and the run going on, and
// the prompt's own state. The bar under the view and the side panel both show it, so it's kept here, once.

const MINIMIZED_KEY = "thingport_studio_prompt_minimized";
const MODEL_KEY = "thingport_studio_ai_model";
const POLL_MS = 1000;

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

type Options = {
  /** Null while no design is open. */
  designId: string | null;
  /** The AIs offered for the assistant; null while loading. */
  offered: StudioAiModels | null;
  /** What's selected in the view, by feature id, sent along so "round this" has a "this". */
  selected: readonly string[];
  /** A step landed: the design changed on the server. */
  onProgress: () => void;
  onError: (message: string) => void;
  onUnauthorized?: () => void;
};

export type StudioAssistant = ReturnType<typeof useStudioAssistant>;

export function useStudioAssistant({ designId, offered, selected, onProgress, onError, onUnauthorized }: Options) {
  const { t } = useTranslation("app");
  const confirm = useConfirm();
  const [minimized, setMinimized] = useState(() => stored(MINIMIZED_KEY) === "true");
  const [modelId, setModelId] = useState<string>(() => stored(MODEL_KEY) ?? "");
  const [thread, setThread] = useState<StudioAssistantThread | null>(null);
  const [sending, setSending] = useState(false);
  const models = offered?.models ?? null;
  const running = thread?.run?.status === "running";

  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof UnauthorizedError) onUnauthorized?.();
      else onError(error instanceof Error ? error.message : String(error));
    },
    [onError, onUnauthorized],
  );

  // The one chosen before while it's still offered, else the default.
  useEffect(() => {
    if (!models?.length || models.some((model) => model.id === modelId)) return;
    setModelId((models.find((model) => model.is_default) ?? models[0]).id);
  }, [models, modelId]);

  // Another design, another conversation.
  useEffect(() => {
    let active = true;
    setThread(null);
    if (!designId) return;
    studioApi.assistant(designId).then(
      (loaded) => active && setThread(loaded),
      (error: unknown) => active && fail(error),
    );
    return () => {
      active = false;
    };
  }, [designId, fail]);

  // While it works: its steps as they land, and the design with them; then its answer.
  const seenSteps = useRef(0);
  useEffect(() => {
    if (!running || !designId) return;
    seenSteps.current = 0;
    const timer = window.setInterval(() => {
      studioApi.assistant(designId).then(
        (next) => {
          const count = next.run?.steps.length ?? 0;
          if (count !== seenSteps.current || next.run?.status !== "running") onProgress();
          seenSteps.current = count;
          setThread(next);
        },
        () => undefined,
      );
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, designId, onProgress]);

  const minimize = (value: boolean) => {
    setMinimized(value);
    store(MINIMIZED_KEY, String(value));
  };

  const chooseModel = (id: string) => {
    setModelId(id);
    store(MODEL_KEY, id);
  };

  /** Starts a run, with pictures the design keeps; false when it didn't start. */
  const send = async (prompt: string, pictures: StudioPicture[] = []): Promise<boolean> => {
    if (!designId || !prompt || running || sending) return false;
    setSending(true);
    try {
      const { run } = await studioApi.ask(designId, {
        prompt,
        ai_connection_id: modelId || null,
        selected: [...selected],
        ...(pictures.length ? { pictures: pictures.map((picture) => picture.id) } : {}),
      });
      // The prompt shows at once; the server has kept it too.
      setThread((current) => ({
        messages: [
          ...(current?.messages ?? []),
          {
            id: `local-${run.started_at}`,
            role: "user",
            text: prompt,
            pictures,
            steps: [],
            outcome: null,
            error: null,
            model: null,
            created_at: run.started_at,
          },
        ],
        run,
      }));
      return true;
    } catch (error) {
      fail(error);
      return false;
    } finally {
      setSending(false);
    }
  };

  const stop = () => {
    if (!designId) return;
    studioApi
      .stopAssistant(designId)
      .then(({ run }) => setThread((current) => (current ? { ...current, run } : current)), fail);
  };

  const clear = async () => {
    const ok = await confirm({
      title: t("studio.prompt.clearTitle"),
      message: t("studio.prompt.clearMessage"),
      confirmLabel: t("studio.prompt.clear"),
      destructive: true,
    });
    if (!ok || !designId) return;
    studioApi.clearAssistant(designId).then(() => setThread({ messages: [], run: null }), fail);
  };

  return {
    designId,
    offered,
    models,
    modelId,
    chooseModel,
    thread,
    messages: thread?.messages ?? [],
    running,
    sending,
    send,
    stop,
    clear,
    minimized,
    minimize,
    /** Says what went wrong, as the rest of the assistant does. */
    fail,
  };
}
