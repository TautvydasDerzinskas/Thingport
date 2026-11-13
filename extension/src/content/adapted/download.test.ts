import { describe, expect, it } from "vitest";
import { DEFAULT_TARGET, type TargetPrinter } from "../../shared/adaptTargets";
import { MAX_BYTES, copyFilename, readBody, sourceFilename } from "./download";

const printer = (model: string): TargetPrinter => ({
  id: "x",
  brandName: "Maker",
  model,
  nozzle: "0.4",
  bed: null,
  height: null,
  extruders: 1,
});

const named = (disposition: string) => new Response("", { headers: { "Content-Disposition": disposition } });

describe("a copy's file", () => {
  it("is named after the file, and the printer it's made for", () => {
    expect(copyFilename("Flexi Rex.3mf", DEFAULT_TARGET)).toBe("Flexi Rex-adapted.3mf");
    expect(copyFilename("Flexi Rex.3MF", { key: "cura", slicer: "cura", printer: null })).toBe("Flexi Rex-adapted.3mf");
    const forP1S = { key: "k", slicer: "bambustudio", printer: printer("P1S") };
    expect(copyFilename("Flexi Rex.3mf", forP1S)).toBe("Flexi Rex-adapted-P1S.3mf");
    const awkward = { key: "k", slicer: "orcaslicer", printer: printer("Ender-3 V3 / KE") };
    expect(copyFilename("a.3mf", awkward)).toBe("a-adapted-Ender-3-V3-KE.3mf");
  });

  it("takes the name the site gives the download", () => {
    expect(sourceFilename(named("attachment; filename*=UTF-8''Dra%C5%BEe%20%2B%20base.3mf"), "https://x/y")).toBe(
      "Draže + base.3mf",
    );
    expect(sourceFilename(named('attachment; filename="plate:1.3mf"'), "https://x/y")).toBe("plate_1.3mf");
    expect(sourceFilename(new Response(""), "https://cdn.example/files/model.3mf?sig=1")).toBe("model.3mf");
    expect(sourceFilename(new Response(""), "https://cdn.example/")).toBe("model.3mf");
  });

  it("is refused past the size the browser can adapt, as it comes", async () => {
    const chunk = new Uint8Array(10 * 1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > MAX_BYTES + chunk.length) controller.close();
        else {
          sent += chunk.length;
          controller.enqueue(chunk);
        }
      },
    });
    const said: string[] = [];
    await expect(readBody(new Response(stream), null, "MakerWorld", (text) => said.push(text))).rejects.toThrow(
      /too big to adapt in the browser \(the limit is 50 MB\)\. Use MakerWorld's regular Download instead\./,
    );
    expect(said.at(-1)).toBe("Downloading 50.0 MB…");
  });
});
