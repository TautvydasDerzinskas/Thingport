import { createContext, useContext } from "react";
import type { RunnableTool } from "./toolSdk";

/** What a model's page lets its tools do with it, through `thingport.ui`: none of it off a model's page. */
export type ModelPageTools = {
  /** Shows the tool's tab in the description box and scrolls to it. */
  showTab: (toolId: string) => void;
  /** Picks one of the model's files, as the side panel's file picker does. */
  selectFile: (fileId: string) => void;
  /** Opens the tool's window on the model. */
  openWindow: (tool: RunnableTool) => void;
};

const ModelPageToolsContext = createContext<ModelPageTools | null>(null);

export const ModelPageToolsProvider = ModelPageToolsContext.Provider;

/** The model page's, or null off one. */
export function useModelPageTools(): ModelPageTools | null {
  return useContext(ModelPageToolsContext);
}
