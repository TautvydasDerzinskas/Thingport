import { describe, expect, it } from "vitest";
import { inputOf, newHow } from "./SendTargetEditor";
import { kindOf, takesFile } from "./sendKinds";

describe("Send to on a model's page", () => {
  it("offers a destination for its file types only, and for any file when it names none", () => {
    expect(takesFile(["gcode", "bgcode"], "Bracket.GCODE")).toBe(true);
    expect(takesFile(["gcode"], "bracket.3mf")).toBe(false);
    expect(takesFile(["3mf"], "print.gcode.3mf")).toBe(true);
    expect(takesFile([], "anything.zip")).toBe(true);
  });

  it("knows a destination's kind from what the page is given", () => {
    expect(kindOf({ kind: "preset", preset: "moonraker" })).toBe("moonraker");
    expect(kindOf({ kind: "link", preset: null })).toBe("link");
    expect(kindOf({ kind: "request", preset: null })).toBe("request");
  });
});

describe("saving a destination", () => {
  const base = {
    name: " OctoPi ",
    placement: "menu" as const,
    fileTypes: [".GCODE", "gcode", " bgcode "],
    clearKey: false,
  };

  it("keeps file endings as the server does, and sends a key only when one was typed or removed", () => {
    const how = newHow("octoprint");
    expect(inputOf({ ...base, how, apiKey: "" })).toEqual({
      name: "OctoPi",
      placement: "menu",
      fileTypes: ["gcode", "bgcode"],
      how,
    });
    expect(inputOf({ ...base, how, apiKey: "k" }).apiKey).toBe("k");
    expect(inputOf({ ...base, how, apiKey: "", clearKey: true }).apiKey).toBeNull();
  });

  it("leaves a stored secret header be when its value is left empty, and drops blank rows", () => {
    const how = {
      ...(newHow("request") as Extract<ReturnType<typeof newHow>, { type: "request" }>),
      url: "http://receiver.local/upload",
      fields: [
        { name: "root", value: "gcodes" },
        { name: " ", value: "x" },
      ],
      headers: [
        { name: "Authorization", secret: true, value: "" },
        { name: "X-Token", secret: true, value: "new" },
        { name: "X-Plain", secret: false, value: "" },
        { name: "", secret: false, value: "x" },
      ],
      thenOpen: "  ",
    };
    const saved = inputOf({ ...base, how, apiKey: "" }).how;
    expect(saved).toMatchObject({
      fields: [{ name: "root", value: "gcodes" }],
      headers: [
        { name: "Authorization", secret: true },
        { name: "X-Token", secret: true, value: "new" },
        { name: "X-Plain", secret: false, value: "" },
      ],
      thenOpen: undefined,
    });
    expect((saved as { headers: { value?: string }[] }).headers[0]).not.toHaveProperty("value");
  });

  it("names a named tab, and drops the name for the other ways of opening", () => {
    expect(inputOf({ ...base, how: { type: "link", url: "https://a.local/", open: "named" }, apiKey: "" }).how).toEqual(
      {
        type: "link",
        url: "https://a.local/",
        open: "named",
        tab: "thingport",
      },
    );
    expect(
      inputOf({ ...base, how: { type: "link", url: "https://a.local/", open: "new", tab: "x" }, apiKey: "" }).how,
    ).toMatchObject({ tab: undefined });
  });
});
