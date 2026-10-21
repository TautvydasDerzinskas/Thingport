-- Which MCP tools the user's API token may call at /api/mcp. Tokens made before MCP existed get the
-- read-only tools: they read nothing the token couldn't already read over the REST API.
ALTER TABLE "User" ADD COLUMN "apiTokenMcpTools" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "User"
SET "apiTokenMcpTools" = ARRAY[
  'search_models', 'list_models', 'get_model', 'list_collections', 'get_collection',
  'list_tags', 'list_categories', 'get_author', 'library_stats', 'get_import_status'
]
WHERE "apiTokenHash" IS NOT NULL;
