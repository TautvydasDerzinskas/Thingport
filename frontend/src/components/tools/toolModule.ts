import type { RunnableTool } from "./toolSdk";

type Draw = (thingport: Record<string, unknown>) => unknown;

/** What a tool's script exports: `default` mounts its window; `run` does a command that has no window; `modelInfo`,
 *  `modelTab` and `modelImage` draw its parts of a model's page. */
export type ToolModule = {
  default?: Draw;
  run?: (command: string, thingport: Record<string, unknown>) => unknown;
  modelInfo?: Draw;
  modelTab?: Draw;
  modelImage?: Draw;
};

// One module per version of a tool's script, shared by every window and command running it.
const modules = new Map<string, Promise<ToolModule>>();

export function loadToolModule(tool: RunnableTool): Promise<ToolModule> {
  let loaded = modules.get(tool.sha);
  if (!loaded) {
    const url = URL.createObjectURL(new Blob([tool.script], { type: "text/javascript" }));
    loaded = import(/* @vite-ignore */ url) as Promise<ToolModule>;
    modules.set(tool.sha, loaded);
    // A script that fails to load is tried afresh next time.
    loaded.catch(() => modules.delete(tool.sha)).finally(() => URL.revokeObjectURL(url));
  }
  return loaded;
}
