import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from "react";
import Box from "@mui/material/Box";
import { useTools } from "../../hooks/useTools";
import type { Tool } from "../../api/tools";
import type { ModelPagePlace, RunnableTool } from "./toolSdk";

// Loaded only once a tool has a part to draw, so a page without one carries none of the running.
const ToolRunner = lazy(() => import("./ToolRunner"));
const ToolWindow = lazy(() => import("./ToolWindow"));

/** The tools the user may run that draw a part of a model's page in `place`, in the order the Tools page lists them. */
export function useToolsWithPart(place: ModelPagePlace): Tool[] {
  const tools = useTools();
  return useMemo(
    () =>
      tools?.access.canUse
        ? tools.tools.filter((tool) =>
            place === "tab" ? tool.manifest.modelPage?.tab : tool.manifest.modelPage?.[place],
          )
        : [],
    [tools, place],
  );
}

type PartProps = {
  tool: RunnableTool;
  place: ModelPagePlace;
  modelId: string;
  /** The file picked on the page; the part is drawn again when it changes. */
  fileId: string | null;
  /** Drawn again when it changes too: whether the model's print profiles are still filling in. */
  revision?: string;
  onUnauthorized?: () => void;
};

const noClose = () => undefined;

/**
 * A tool's part of a model's page: an empty element its script draws into. Nothing shows until it does, and nothing at
 * all while it draws nothing, so a tool can leave a model it has nothing to say about alone.
 */
export function ToolPart({ tool, place, modelId, fileId, revision, onUnauthorized }: PartProps) {
  const context = useMemo(() => ({ modelId, ...(fileId ? { fileId } : {}) }), [modelId, fileId]);
  return (
    <Box
      data-tool-part={place}
      // An empty part takes no room, nor the spacing a list of them would give it; one that failed says so.
      sx={{
        minWidth: 0,
        "&:empty, &:not(:has([role='alert'])):has(> [data-tool-frame]:empty, > [data-tool-frame] > :empty:only-child)":
          { display: "none" },
      }}
    >
      <Suspense fallback={null}>
        <ToolRunner
          tool={tool}
          place={place}
          context={context}
          revision={revision}
          onClose={noClose}
          onUnauthorized={onUnauthorized}
        />
      </Suspense>
    </Box>
  );
}

/** Opens a tool's window on a model, from one of its parts of the page. */
export function useToolWindowHost(
  modelId: string,
  onUnauthorized?: () => void,
): { open: (tool: RunnableTool) => void; element: ReactNode } {
  // Held with the model it was opened on: the page stays as another model opens, and the window doesn't go with it.
  const [shown, setShown] = useState<{ tool: RunnableTool; modelId: string } | null>(null);
  if (shown && shown.modelId !== modelId) setShown(null);
  const open = useCallback((tool: RunnableTool) => setShown({ tool, modelId }), [modelId]);
  const context = useMemo(() => ({ modelId }), [modelId]);
  return {
    open,
    element: shown?.modelId === modelId && (
      <Suspense fallback={null}>
        <ToolWindow
          tool={shown.tool}
          context={context}
          onClose={() => setShown(null)}
          onUnauthorized={onUnauthorized}
        />
      </Suspense>
    ),
  };
}
