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
import { MCP_TOOLS, type McpToolContext } from "./tools";

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
          // Nothing here deletes or overwrites.
          destructiveHint: false,
          idempotentHint: tool.idempotent ?? tool.readOnly,
          openWorldHint: tool.openWorld ?? false,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.run(ctx, args);
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
