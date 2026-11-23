import type { Tool, ToolCommand } from "../../api/tools";

/** A tool's command with the label shown in the user's language. */
export type OfferedCommand = { key: string; tool: Tool; command: ToolCommand; label: string };

/** The file picked on the model page, as a command sees it: a plate, or the prepared print, which has no plate. */
export type CommandFile = { filename: string; plateId: string | null };

/** The Tools page opens this tool as soon as its list is available. */
export const toolOpenPath = (toolId: string) => `/tools?open=${encodeURIComponent(toolId)}`;

/** The command's title in the user's language, from the tool's labels (`commands.<id>`), else as its metadata has it. */
export function commandLabel(tool: Pick<Tool, "locales">, command: ToolCommand, language: string): string {
  const key = `commands.${command.id}`;
  const locales = tool.locales ?? {};
  return locales[language]?.[key] ?? locales[language.split("-")[0]]?.[key] ?? locales.en?.[key] ?? command.title;
}

/** Whether a "file" command takes this file: one of its types, matched on the end of the name. */
export function takesFile(command: ToolCommand, file: CommandFile | null): boolean {
  if (command.on !== "file") return command.on === "model";
  // The prepared print isn't one of the model's files a tool can read.
  if (!file?.plateId) return false;
  if (!command.fileTypes?.length) return true;
  const name = file.filename.toLowerCase();
  return command.fileTypes.some((type) => name.endsWith(`.${type}`));
}

/** The commands the tools offer for the model page or for a selection, in tool order. */
export function commandsFor(
  tools: Tool[],
  target: CommandFile | "selection" | null,
  language: string,
): OfferedCommand[] {
  return tools.flatMap((tool) =>
    (tool.manifest.commands ?? [])
      .filter((command) => (target === "selection" ? command.on === "selection" : takesFile(command, target)))
      .map((command) => ({
        key: `${tool.id}:${command.id}`,
        tool,
        command,
        label: commandLabel(tool, command, language),
      })),
  );
}
