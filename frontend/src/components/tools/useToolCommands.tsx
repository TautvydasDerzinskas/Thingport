import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import { UnauthorizedError } from "../../api/client";
import { SUPPORTED_LANGUAGES, matchLanguage } from "../../constants/languages";
import { useTools } from "../../hooks/useTools";
import { sdkTheme } from "../../sdk/theme";
import { scriptToast } from "../../sdk/toast";
import { useConfirm } from "../ConfirmProvider";
import { useToast } from "../ToastProvider";
import { commandsFor, toolOpenPath, type CommandFile, type OfferedCommand } from "./toolCommands";
import type { SdkAudience, SdkModel } from "../../sdk/types";
import type { RunnableTool, ToolCollection, ToolContext } from "./toolSdk";
import { useAskQueue } from "./useAskQueue";
import type { ModelPickQuestion } from "./ToolModelPicker";
import { useModelPageTools } from "./modelPageTools";

// Loaded once a command is picked, so a page whose tools offer none carries none of the running.
const ToolWindow = lazy(() => import("./ToolWindow"));
const CollectionPickerDialog = lazy(() => import("./CollectionPickerDialog"));
const ToolShareDialog = lazy(() => import("./ToolShareDialog"));
const ToolModelPicker = lazy(() => import("./ToolModelPicker"));

type CommandTarget = { modelId: string; file: CommandFile | null } | { modelIds: readonly string[] };

/**
 * The commands offered on a model page or for a grid selection. Each opens its tool's window or calls the script's
 * `run` export with the page's toasts and confirmations.
 */
export function useToolCommands(
  target: CommandTarget,
  onUnauthorized?: () => void,
): {
  commands: OfferedCommand[];
  run: (offered: OfferedCommand) => Promise<void>;
  element: ReactNode;
} {
  const { t, i18n } = useTranslation("app");
  const tools = useTools();
  const muiTheme = useTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const page = useModelPageTools();
  const language = matchLanguage(i18n.language);
  const isSelection = "modelIds" in target;
  const modelId = isSelection ? undefined : target.modelId;
  const [open, setOpen] = useState<{ tool: RunnableTool; context: ToolContext } | null>(null);
  const picks = useAskQueue<{ title?: string }, ToolCollection | null>();
  const shares = useAskQueue<{ tool: { id: string; name: string } }, SdkAudience | null>();
  const modelPicks = useAskQueue<ModelPickQuestion, SdkModel[]>();
  // The model the page is on, undefined for a grid, and null after unmount. A run can act on that page while present.
  const onModel = useRef<string | null | undefined>(modelId);
  useEffect(() => {
    onModel.current = modelId;
    return () => {
      onModel.current = null;
    };
  }, [modelId]);

  const file = isSelection ? null : target.file;
  const filename = file?.filename ?? null;
  const plateId = file?.plateId ?? null;
  const available = tools?.access.canUse ? tools.tools : null;
  const commands = useMemo(
    () =>
      available
        ? commandsFor(available, isSelection ? "selection" : filename === null ? null : { filename, plateId }, language)
        : [],
    [available, isSelection, filename, plateId, language],
  );

  const openModel = (id: string) => navigate(`/models/${encodeURIComponent(id)}`);

  const runWindowless = async (tool: RunnableTool, context: ToolContext) => {
    const here = () => onModel.current === context.modelId;
    const openWindow = () => {
      if (here()) setOpen({ tool, context: { modelId: context.modelId, modelIds: context.modelIds } });
    };
    const id = tool.id;
    try {
      const [{ buildToolSdk }, { loadToolModule }] = await Promise.all([import("./toolSdk"), import("./toolModule")]);
      // Never ended: a run may leave a question open after `run` returns, and nothing restarts it.
      const asks = picks.session();
      const shareAsks = shares.session();
      const modelAsks = modelPicks.session();
      const thingport = buildToolSdk({
        tool,
        context,
        // Nothing shows it: a command without a window has only the page's toasts and dialogs.
        root: document.createElement("div"),
        selector: "",
        theme: sdkTheme(muiTheme),
        language,
        languages: SUPPORTED_LANGUAGES,
        size: () => ({ width: 0, height: 0 }),
        onResize: () => () => undefined,
        ui: {
          toast: (message, severity = "info", options) =>
            toast(
              scriptToast(message, severity, options, {
                label: t("common:open"),
                openModel,
                openWindow: id ? () => (here() ? openWindow() : navigate(toolOpenPath(id))) : undefined,
              }),
            ),
          confirm: async (options) =>
            (await confirm({
              title: options.title,
              message: options.message,
              confirmLabel: options.confirmLabel,
              destructive: options.destructive,
            })) === true,
          pickCollection: (options) => asks.ask({ title: options?.title }),
          pickModels: (options) =>
            modelAsks.ask({ title: options?.title, confirmLabel: options?.confirmLabel, max: options?.max }),
          openModel,
          close: () => undefined,
          popover: () => {
            throw new Error(t("tools.runner.noPopover"));
          },
          showTab: () => {
            if (here() && tool.id && tool.manifest.modelPage?.tab) page?.showTab(tool.id);
          },
          selectFile: (fileId) => {
            if (here()) page?.selectFile(fileId);
          },
          openWindow,
        },
        pickAudience: () => shareAsks.ask({ tool: { id: tool.id ?? "", name: tool.manifest.name } }),
      });
      const module = await loadToolModule(tool);
      if (typeof module.run !== "function") throw new Error(t("tools.runner.noRun"));
      await module.run(context.command ?? "", thingport);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      toast({
        message: t("tools.runner.commandFailed", {
          name: tool.manifest.name,
          error: err instanceof Error ? err.message : String(err),
        }),
        severity: "error",
      });
    }
  };

  const run = async (offered: OfferedCommand) => {
    if (isSelection && target.modelIds.length === 0) return;
    const context: ToolContext = isSelection
      ? { modelIds: [...target.modelIds], command: offered.command.id }
      : { modelId, command: offered.command.id };
    if (offered.command.on === "file" && plateId) context.fileId = plateId;
    if (offered.command.window) setOpen({ tool: offered.tool, context });
    else await runWindowless(offered.tool, context);
  };

  const element =
    open || picks.shown || shares.shown || modelPicks.open ? (
      <Suspense fallback={null}>
        {open && (
          <ToolWindow
            tool={open.tool}
            context={open.context}
            onClose={() => setOpen(null)}
            onUnauthorized={onUnauthorized}
          />
        )}
        {picks.shown && (
          <CollectionPickerDialog
            key={picks.shown.id}
            open={picks.open}
            title={picks.shown.title}
            onUnauthorized={onUnauthorized}
            onClose={picks.answer}
          />
        )}
        {shares.shown && (
          <ToolShareDialog
            key={`share-${shares.shown.id}`}
            open={shares.open}
            tool={shares.shown.tool}
            onUnauthorized={onUnauthorized}
            onClose={shares.answer}
          />
        )}
        <ToolModelPicker
          question={modelPicks.open ? modelPicks.shown : null}
          onAnswer={modelPicks.answer}
          onUnauthorized={onUnauthorized}
        />
      </Suspense>
    ) : null;

  return { commands, run, element };
}
