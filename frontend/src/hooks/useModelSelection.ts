import type { Print } from "../api/prints";
import { type Selection, useSelection } from "./useSelection";

export type ModelSelection = Selection<Print>;

const printKey = (print: Print) => print.id;

/** Multi-select over a grid's loaded models. */
export function useModelSelection(items: Print[]): ModelSelection {
  return useSelection(items, printKey);
}

/** `items` with each of `updated` put in place of the model it updates. */
export function replacePrints(items: Print[], updated: Print[]): Print[] {
  const byId = new Map(updated.map((print) => [print.id, print]));
  return items.map((item) => byId.get(item.id) ?? item);
}
