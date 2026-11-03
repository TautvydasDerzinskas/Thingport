import type { z } from "zod";

// What an MCP tool is, apart from the tools themselves (tools.ts), so the tools kept elsewhere (studioTools.ts) can be
// one without importing the list they're in.

export type McpToolContext = {
  userId: string;
  /** The instance's address as an admin set it, "" when unset: see getPublicUrl. */
  publicUrl: string;
};

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  /** A write tool a new token gets anyway, for writes that stay in the user's own space. */
  defaultOn?: boolean;
  /** Changes or removes something already there, rather than only adding: MCP's destructiveHint. */
  destructive?: boolean;
  /** Calling it again with the same arguments changes nothing more. */
  idempotent?: boolean;
  /** Reaches outside this Thingport, e.g. a provider's site. */
  openWorld?: boolean;
  /** Tools shown and turned on together in a token's permissions, as one row: Studio's are many small steps. */
  group?: "studio";
  inputSchema: z.ZodRawShape;
  run: (ctx: McpToolContext, args: Record<string, unknown>) => Promise<unknown>;
};

/** A result that also shows the assistant pictures, beside its JSON. */
export class WithImages {
  constructor(
    readonly data: unknown,
    readonly images: { data: string; mimeType: string }[],
  ) {}
}
