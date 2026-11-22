import { expect, it } from "vitest";
import { MCP_TOOLS } from "../src/mcp/tools";

// What an assistant reads of the tools that find, read and change a model's files: any change to it shows in review as
// a change to this snapshot, where a file's role (`kind`) and what the file is (`content_kind`) keep their own names.

const TOOLS = [
  "search_models",
  "list_models",
  "get_model",
  "list_model_files",
  "get_model_file",
  "add_model_files",
  "remove_model_file",
  "rename_model_file",
];

it("describes the model file tools as the snapshot pins", async () => {
  const described = TOOLS.map((name) => {
    const tool = MCP_TOOLS.find((one) => one.name === name);
    if (!tool) throw new Error(`No MCP tool ${name}`);
    const inputs = Object.fromEntries(
      Object.entries(tool.inputSchema ?? {}).map(([key, schema]) => [
        key,
        (schema as { description?: string }).description ?? null,
      ]),
    );
    return { name: tool.name, title: tool.title, description: tool.description, inputs };
  });
  await expect(`${JSON.stringify(described, null, 2)}\n`).toMatchFileSnapshot("./__snapshots__/mcp-model-files.json");
});
