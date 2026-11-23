import { useState } from "react";
import type { Print } from "../../api/prints";
import CustomizerDialog from "../../components/customizer/CustomizerDialog";
import ScriptPickerDialog from "../../components/customizer/ScriptPickerDialog";

/** Whether the model came with a script it can be generated from again. */
export function hasGeneratorScript(print: Print): boolean {
  return (print.generator_scripts?.length ?? 0) > 0;
}

/**
 * "Customize" for a model that came with the script it was generated from.
 *
 * The customizer is part of the app, not the openscad-customizer tool: a model's own script opens whether or
 * not an admin has installed anything. The tool is still there for scripts that aren't a model's -- one opened
 * from a file, or a model picked from the library.
 *
 * The window it opens is rendered by the caller outside any menu: a menu unmounts its children as it closes, which
 * would take the customizer with it the moment it opened.
 */
export function useCustomize(print: Print, onUnauthorized?: () => void) {
  const scripts = print.generator_scripts ?? [];
  const available = scripts.length > 0;
  // Which script is open; "pick" while a model with several is waiting to be asked.
  const [open, setOpen] = useState<{ scriptId: string } | "pick" | null>(null);
  // The page header keeps this across models: leaving the model closes it, so another's print never gets its script.
  const [openFor, setOpenFor] = useState(print.id);
  if (openFor !== print.id) {
    setOpenFor(print.id);
    setOpen(null);
  }

  const start = () => setOpen(scripts.length > 1 ? "pick" : { scriptId: scripts[0].id });

  const window = (
    <>
      {open === "pick" && (
        <ScriptPickerDialog
          scripts={scripts}
          onPick={(scriptId) => setOpen({ scriptId })}
          onClose={() => setOpen(null)}
        />
      )}
      {open && open !== "pick" && (
        <CustomizerDialog
          print={print}
          scriptId={open.scriptId}
          onUnauthorized={onUnauthorized}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );

  return { window, available, start };
}
