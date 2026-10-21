import { Router, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { asyncHandler } from "../utils/asyncHandler";
import { findApiTokenUser, isApiToken } from "../services/apiTokenService";
import { buildMcpServer } from "../mcp/server";
import { mcpToolsFor } from "../mcp/tools";
import { getMcpAccess, getPublicUrl } from "../services/settingsService";

// The MCP endpoint (Streamable HTTP, stateless): an assistant connects with the user's API token.
//
// Not behind requireAuth, which refuses an API token anything but GET: every MCP message is a POST.
// The read-only promise is kept by the tools instead. A token only ever reaches the ones its user
// ticked and the instance's MCP access offers, and a tool that writes is off until they do. Mounted before every router that applies
// requireAuth to all its paths, or those would turn the POST away first.

const router = Router();

const MCP_PATH = "/mcp";

function bearerToken(req: Request): string | null {
  const header = req.header("authorization");
  return header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
}

function jsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

router.post(
  MCP_PATH,
  asyncHandler(async (req, res) => {
    const token = bearerToken(req);
    // API tokens only: a session token lasts hours and belongs to the web app, not to a tool's config.
    const user = token && isApiToken(token) ? await findApiTokenUser(token) : null;
    if (!user) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="thingport"');
      jsonRpcError(res, 401, "Send your Thingport API token as 'Authorization: Bearer tp_...'");
      return;
    }
    const access = await getMcpAccess();
    if (access === "off") {
      jsonRpcError(res, 403, "An admin has turned MCP off on this Thingport");
      return;
    }
    const offered = new Set(mcpToolsFor(access).map((tool) => tool.name));
    const allowed = new Set(user.apiTokenMcpTools.filter((name) => offered.has(name)));
    const server = buildMcpServer({ userId: user.id, publicUrl: await getPublicUrl() }, allowed);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }),
);

// Stateless: there's no session to stream events on (GET) or to end (DELETE).
router.get(MCP_PATH, (_req, res) => jsonRpcError(res, 405, "Method not allowed"));
router.delete(MCP_PATH, (_req, res) => jsonRpcError(res, 405, "Method not allowed"));

export default router;
