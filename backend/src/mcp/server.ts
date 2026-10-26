import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import { HttpError } from "../utils/fileUtils";
import { getBackendVersion } from "../services/versionService";
import { assertNotToolModels } from "../services/toolsService";
import { MCP_TOOLS, WithImages, type McpToolContext } from "./tools";

// The tools that change a model's files or pictures, refused for a model a Thingport tool brought, which stays as the
// tool needs it (services/toolsService.ts). edit_model may only favourite one, and delete_model is refused by printEditService.
const CHANGES_MODEL_FILES = new Set(["add_model_files", "remove_model_file", "edit_model_images", "rename_model_file"]);

/** A server offering only the tools this token was given. One per request: /api/mcp is stateless. */
export function buildMcpServer(ctx: McpToolContext, allowedTools: ReadonlySet<string>): McpServer {
  const server = new McpServer(
    { name: "thingport", title: "Thingport", version: getBackendVersion() ?? "unknown" },
    {
      instructions:
        "Thingport is the user's self-hosted library of 3D-printable models. Find models with search_models or " +
        "list_models, then read one with get_model. Ids from one tool are what the others take.",
    },
  );
  // registerTool's generics recurse past TypeScript's limit (TS2589) on a shape typed as any zod shape.
  // The SDK still validates each call's arguments against inputSchema before the callback runs.
  const registerTool = server.registerTool.bind(server) as unknown as (
    name: string,
    config: { title: string; description: string; inputSchema: ZodRawShape; annotations: ToolAnnotations },
    callback: (args: Record<string, unknown>) => Promise<CallToolResult>,
  ) => void;
  for (const tool of MCP_TOOLS) {
    if (!allowedTools.has(tool.name)) continue;
    registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: tool.destructive ?? false,
          idempotentHint: tool.idempotent ?? tool.readOnly,
          openWorldHint: tool.openWorld ?? false,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          // edit_model may still favourite one.
          const edits =
            tool.name === "edit_model" && Object.keys(args).some((k) => k !== "model_id" && k !== "favorite");
          if ((CHANGES_MODEL_FILES.has(tool.name) || edits) && typeof args.model_id === "string")
            await assertNotToolModels([args.model_id]);
          const result = await tool.run(ctx, args);
          if (result instanceof WithImages) {
            return {
              content: [
                { type: "text" as const, text: JSON.stringify(result.data) },
                ...result.images.map((image) => ({ type: "image" as const, ...image })),
              ],
            };
          }
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch (err) {
          // An HttpError is meant for the caller ("Print not found"); anything else stays in the logs.
          if (err instanceof HttpError) {
            return { isError: true, content: [{ type: "text" as const, text: err.message }] };
          }
          console.error(`[mcp] ${tool.name} failed`, err);
          return { isError: true, content: [{ type: "text" as const, text: "Something went wrong on the server." }] };
        }
      },
    );
  }
  // The SDK only answers tools/list once a tool is registered. A token with every tool turned off
  // should see an empty list, not a "method not found" an assistant would report as a broken server.
  if (![...allowedTools].some((name) => MCP_TOOLS.some((tool) => tool.name === name))) {
    server.server.registerCapabilities({ tools: {} });
    server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
    server.server.setRequestHandler(CallToolRequestSchema, (request) => ({
      isError: true,
      content: [{ type: "text" as const, text: `Tool ${request.params.name} isn't turned on for this token.` }],
    }));
  }
  return server;
}
