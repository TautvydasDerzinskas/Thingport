import type { Tool, ToolCommand } from "../../api/tools";

/** A tool's command as the model page offers it. */
export type OfferedCommand = { key: string; tool: Tool; command: ToolCommand; label: string };

/** The file picked on the model page, as a command sees it: a plate, or the prepared print, which has no plate. */
export type CommandFile = { filename: string; plateId: string | null };

/** The command's title in the user's language, from the tool's labels (`commands.<id>`), else as its metadata has it. */
export function commandLabel(tool: Pick<Tool, "locales">, command: ToolCommand, language: string): string {
  const key = `commands.${command.id}`;
  const locales = tool.locales ?? {};
  return locales[language]?.[key] ?? locales[language.split("-")[0]]?.[key] ?? locales.en?.[key] ?? command.title;
}

/** Whether a "file" command takes this file: one of its types, matched on the end of the name. */
export function takesFile(command: ToolCommand, file: CommandFile | null): boolean {
  if (command.on !== "file") return true;
  // The prepared print isn't one of the model's files a tool can read.
  if (!file?.plateId) return false;
  if (!command.fileTypes?.length) return true;
  const name = file.filename.toLowerCase();
  return command.fileTypes.some((type) => name.endsWith(`.${type}`));
}

/** The commands the tools offer for this model and file, tool by tool in the order they came. */
export function commandsFor(tools: Tool[], file: CommandFile | null, language: string): OfferedCommand[] {
  return tools.flatMap((tool) =>
    (tool.manifest.commands ?? [])
      .filter((command) => takesFile(command, file))
      .map((command) => ({
        key: `${tool.id}:${command.id}`,
        tool,
        command,
        label: commandLabel(tool, command, language),
      })),
  );
}
