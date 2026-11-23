import { describe, expect, it } from "vitest";
import type { Tool, ToolCommand } from "../../api/tools";
import { commandLabel, commandsFor, takesFile } from "./toolCommands";

function tool(id: string, commands: ToolCommand[] | undefined, locales: Tool["locales"] = {}): Tool {
  return {
    id,
    source: "repo",
    slug: id,
    manifest: { name: id, description: "", version: "1.0.0", window: { width: 960, height: 640 }, hosts: [], commands },
    script: "",
    html: null,
    locales,
    sha: id,
    updatedAt: "2026-11-16T00:00:00Z",
    collectionId: null,
  };
}

const estimate: ToolCommand = {
  id: "estimate",
  title: "Estimate",
  on: "file",
  fileTypes: ["stl", "3mf"],
  window: true,
};
const queue: ToolCommand = { id: "queue", title: "Add to queue", on: "model", window: false };
const anyFile: ToolCommand = { id: "inspect", title: "Inspect", on: "file", window: true };

describe("tool commands on the model page", () => {
  it("offers nothing when no tool has commands, so the menu stays as it was", () => {
    expect(commandsFor([tool("a", undefined), tool("b", [])], { filename: "a.stl", plateId: "p" }, "en")).toEqual([]);
  });

  it("offers a model's commands whatever the file, and a file's only for a type it takes", () => {
    const tools = [tool("cost", [estimate]), tool("queue", [queue])];
    const ids = (filename: string, plateId: string | null = "p") =>
      commandsFor(tools, { filename, plateId }, "en").map((offered) => offered.key);
    expect(ids("part.STL")).toEqual(["cost:estimate", "queue:queue"]);
    expect(ids("print.gcode.3mf")).toEqual(["cost:estimate", "queue:queue"]);
    expect(ids("notes.pdf")).toEqual(["queue:queue"]);
  });

  it("keeps selection commands in the grid and single-model commands on the model page", () => {
    const bulk: ToolCommand = { id: "bulk", title: "Process selection", on: "selection", window: false };
    const tools = [tool("a", [queue, estimate, bulk]), tool("b", undefined)];
    expect(commandsFor(tools, "selection", "en").map((offered) => offered.key)).toEqual(["a:bulk"]);
    expect(commandsFor(tools, null, "en").map((offered) => offered.key)).toEqual(["a:queue"]);
    expect(commandsFor([], "selection", "en")).toEqual([]);
  });

  it("leaves file commands out for the prepared print, which tools can't read, and with no file at all", () => {
    expect(takesFile(anyFile, { filename: "print.gcode.3mf", plateId: null })).toBe(false);
    expect(takesFile(anyFile, null)).toBe(false);
    expect(takesFile(anyFile, { filename: "x.anything", plateId: "p" })).toBe(true);
    expect(takesFile(queue, null)).toBe(true);
  });

  it("titles a command in the user's language, falling back to English and then to its metadata", () => {
    const labelled = tool("cost", [estimate], {
      en: { "commands.estimate": "Estimate print cost" },
      lt: { "commands.estimate": "Įvertinti spausdinimo kainą" },
    });
    expect(commandLabel(labelled, estimate, "lt")).toBe("Įvertinti spausdinimo kainą");
    expect(commandLabel(labelled, estimate, "fr")).toBe("Estimate print cost");
    expect(commandLabel(tool("bare", [estimate]), estimate, "lt")).toBe("Estimate");
  });
});
