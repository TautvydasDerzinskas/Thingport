import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TARGET, type TargetPrinter } from "../../shared/adaptTargets";
import { MAX_BYTES, copyFilename, fetchFile, readBody, sourceFilename, tooBig } from "./download";

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
      /too big to adapt in the browser \(the limit is 50 MB\)\. Use the regular Download on MakerWorld instead\./,
    );
    expect(said.at(-1)).toBe("Downloading 50.0 MB…");
  });
});

/** The file server's one answer, to every request. */
function served(body: string, init: ResponseInit = {}) {
  const fetch = vi.fn(async () => new Response(body, init));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const quiet = () => undefined;
const plainTextNote = (res: Response) => /^text\/plain/i.test(res.headers.get("Content-Type") ?? "");

describe("a site's file", () => {
  afterEach(() => void vi.unstubAllGlobals());

  it("is refused where the file server says no, or what came isn't the file", async () => {
    served("nope", { status: 403 });
    await expect(fetchFile("https://files.example/a", "Printables", quiet)).rejects.toThrow(
      "The Printables file server refused the download (403).",
    );
    served("not this link", { headers: { "Content-Type": "text/plain" } });
    await expect(
      fetchFile("https://files.example/a", "Snapmaker Space", quiet, { refused: plainTextNote }),
    ).rejects.toThrow("The Snapmaker Space file server refused the download (200).");
  });

  it("is refused past the size the browser can adapt, as soon as the server says its size", async () => {
    served("x", { headers: { "Content-Length": String(MAX_BYTES + 1) } });
    await expect(fetchFile("https://files.example/a", "MakerWorld", quiet)).rejects.toThrow("too big to adapt");
  });

  it("comes with the answer it came in, asked for as the site wants", async () => {
    const fetch = served("PK", { headers: { "Content-Disposition": 'attachment; filename="plate.3mf"' } });
    const { res, bytes } = await fetchFile("https://files.example/a", "NexPrint", quiet, {
      init: { credentials: "omit" },
    });
    expect(new TextDecoder().decode(bytes)).toBe("PK");
    expect(sourceFilename(res, "https://files.example/a")).toBe("plate.3mf");
    expect(fetch).toHaveBeenCalledWith("https://files.example/a", { credentials: "omit" });
  });

  it("names the site whose Download to use instead", () => {
    expect(tooBig(60 * 1024 * 1024, "Printables").message).toContain("Use the regular Download on Printables instead.");
  });
});
