import { useState } from "react";
import { useTranslation } from "react-i18next";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import TuneIcon from "@mui/icons-material/Tune";
import type { Print } from "../../api/prints";
import { useTools } from "../../hooks/useTools";
import ToolWindow from "../../components/tools/ToolWindow";

/** The tool that opens a model's script; the entry is only there when an admin has installed it. */
const CUSTOMIZER = "openscad-customizer";

/** Whether the model came with a script it can be generated from again. */
export function hasGeneratorScript(print: Print): boolean {
  return (print.generator_scripts?.length ?? 0) > 0;
}

/**
 * "Customize" for a model that came with the script it was generated from.
 *
 * The entry and the window it opens come back separately because the window can't live inside the menu: the
 * menu unmounts its children as it closes, which would take the tool with it the moment it was opened.
 */
export function useCustomize(print: Print, closeMenu: () => void) {
  const { t } = useTranslation("models");
  const tools = useTools();
  const [running, setRunning] = useState(false);
  const tool = tools?.tools.find((candidate) => candidate.slug === CUSTOMIZER) ?? null;
  const available = Boolean(tool) && hasGeneratorScript(print);

  const item = available ? (
    <MenuItem
      onClick={() => {
        closeMenu();
        setRunning(true);
      }}
    >
      <ListItemIcon>
        <TuneIcon fontSize="small" />
      </ListItemIcon>
      <ListItemText>{t("detail.customize")}</ListItemText>
    </MenuItem>
  ) : null;

  const window = available ? (
    <ToolWindow tool={running ? tool : null} context={{ modelId: print.id }} onClose={() => setRunning(false)} />
  ) : null;

  return { item, window };
}
