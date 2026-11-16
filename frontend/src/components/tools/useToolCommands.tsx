import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
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
import { commandsFor, type CommandFile, type OfferedCommand } from "./toolCommands";
import type { SdkAudience } from "../../sdk/types";
import type { RunnableTool, ToolCollection, ToolContext } from "./toolSdk";
import { useAskQueue } from "./useAskQueue";

// Loaded once a command is picked, so a page whose tools offer none carries none of the running.
const ToolWindow = lazy(() => import("./ToolWindow"));
const CollectionPickerDialog = lazy(() => import("./CollectionPickerDialog"));
const ToolShareDialog = lazy(() => import("./ToolShareDialog"));

/**
 * The tools' commands for a model and the file picked on its page, and what runs one: its tool's window opens on the
 * model, or for a command with `window: false` the script's `run` export is called with no window, its toasts and
 * confirmations the page's own. Where no tool offers any, `commands` is empty and `element` is nothing.
 */
export function useToolCommands(
  modelId: string,
  file: CommandFile | null,
  onUnauthorized?: () => void,
): {
  commands: OfferedCommand[];
  run: (offered: OfferedCommand) => void;
  /** Opens a tool's window on the model, with no command: from a person's chip in its part of the page. */
  openTool: (tool: RunnableTool) => void;
  element: ReactNode;
} {
  const { t, i18n } = useTranslation("app");
  const tools = useTools();
  const muiTheme = useTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const language = matchLanguage(i18n.language);
  const [open, setOpen] = useState<{ tool: RunnableTool; context: ToolContext } | null>(null);
  const picks = useAskQueue<{ title?: string }, ToolCollection | null>();
  const shares = useAskQueue<{ tool: { id: string; name: string } }, SdkAudience | null>();

  const filename = file?.filename ?? null;
  const plateId = file?.plateId ?? null;
  const commands = useMemo(
    () =>
      tools?.access.canUse ? commandsFor(tools.tools, filename === null ? null : { filename, plateId }, language) : [],
    [tools, filename, plateId, language],
  );

  const openModel = (id: string) => navigate(`/models/${encodeURIComponent(id)}`);

  const runWindowless = async (tool: RunnableTool, context: ToolContext) => {
    try {
      const [{ buildToolSdk }, { loadToolModule }] = await Promise.all([import("./toolSdk"), import("./toolModule")]);
      // Never ended: a run may leave a question open after `run` returns, and nothing restarts it.
      const asks = picks.session();
      const shareAsks = shares.session();
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
            toast(scriptToast(message, severity, options, { label: t("common:open"), openModel })),
          confirm: async (options) =>
            (await confirm({
              title: options.title,
              message: options.message,
              confirmLabel: options.confirmLabel,
              destructive: options.destructive,
            })) === true,
          pickCollection: (options) => asks.ask({ title: options?.title }),
          openModel,
          close: () => undefined,
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

  const run = (offered: OfferedCommand) => {
    const context: ToolContext = { modelId, command: offered.command.id };
    if (offered.command.on === "file" && plateId) context.fileId = plateId;
    if (offered.command.window) setOpen({ tool: offered.tool, context });
    else void runWindowless(offered.tool, context);
  };

  const element =
    open || picks.shown || shares.shown ? (
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
      </Suspense>
    ) : null;

  const openTool = (tool: RunnableTool) => setOpen({ tool, context: { modelId } });

  return { commands, run, openTool, element };
}
