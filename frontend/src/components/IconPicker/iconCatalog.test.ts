import { describe, expect, it } from "vitest";
import { BUILTIN_ICONS } from "./iconCatalog";

const PATH = "../../../../backend/src/mcp/builtinIcons.json";
// The backend's copy, which the MCP `list_icons` tool offers; missing where only the frontend is checked out.
const copies = import.meta.glob<unknown>("../../../../backend/src/mcp/builtinIcons.json", {
  eager: true,
  import: "default",
});

describe("built-in icons", () => {
  it.skipIf(!(PATH in copies))("are the ones the MCP list_icons tool offers (npm run icons:sync)", async () => {
    if (import.meta.env.VITE_UPDATE_BUILTIN_ICONS) {
      // Node's own module, which the browser-typed frontend has no types for.
      const fsModule = "node:fs";
      const fs = (await import(/* @vite-ignore */ fsModule)) as { writeFileSync(path: string, data: string): void };
      fs.writeFileSync(new URL(PATH, import.meta.url).pathname, `${JSON.stringify(BUILTIN_ICONS, null, 2)}\n`);
      return;
    }
    expect(copies[PATH]).toEqual(BUILTIN_ICONS);
  });

  it("have unique values", () => {
    const values = BUILTIN_ICONS.map((icon) => icon.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
