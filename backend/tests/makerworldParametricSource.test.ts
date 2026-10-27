import { afterEach, describe, expect, it, vi } from "vitest";
import { makerworldMetaFromDesign } from "../src/providers/makerworld/pageData";
import { resolveMakerworldViaCloudApi } from "../src/providers/makerworld/api";

// The shapes here are MakerWorld's own, taken from design-service answers: 831106 (a Parametric Model Maker
// keychain whose source is shared), 3082544 (five protected sources) and an ordinary model with no .scad.

const designWith = (modelFiles: unknown[], rest: Record<string, unknown> = {}) => ({
  title: "Example",
  designExtension: { model_files: modelFiles },
  ...rest,
});

const scadFile = (modelName: string, isProtected: boolean) => ({
  modelName,
  modelType: "scad",
  modelUrl: "",
  scadStatus: 2,
  protected: isProtected,
});

describe("makerworldMetaFromDesign: generator scripts", () => {
  it("reads a shared source and says it isn't withheld", () => {
    const meta = makerworldMetaFromDesign(
      designWith([scadFile("keychain_customizable.scad", false)], { categoryByMakerLab: "Parametric Model Maker" }),
    );

    expect(meta.parametricSource).toEqual({ filenames: ["keychain_customizable.scad"], withheld: false });
  });

  it("marks a design whose every source is protected as withheld", () => {
    const meta = makerworldMetaFromDesign(
      designWith([
        scadFile("ElectronicsPanelGenerator.scad", true),
        scadFile("ElectronicsPanelGenerator V2.scad", true),
      ]),
    );

    expect(meta.parametricSource).toEqual({
      filenames: ["ElectronicsPanelGenerator.scad", "ElectronicsPanelGenerator V2.scad"],
      withheld: true,
    });
  });

  it("is not withheld while one source is still shared, since the zip will carry that one", () => {
    const meta = makerworldMetaFromDesign(designWith([scadFile("open.scad", false), scadFile("closed.scad", true)]));

    expect(meta.parametricSource?.withheld).toBe(false);
  });

  it("goes by the files, not by categoryByMakerLab, which plenty of such designs leave empty", () => {
    const meta = makerworldMetaFromDesign(
      designWith([scadFile("BeamGenerator.scad", false)], {
        categoryByMakerLab: "",
      }),
    );

    expect(meta.parametricSource?.filenames).toEqual(["BeamGenerator.scad"]);
  });

  it("recognises a source the file list doesn't type, by its extension", () => {
    const meta = makerworldMetaFromDesign(
      designWith([{ modelName: "generator.scad", modelType: "", protected: false }]),
    );

    expect(meta.parametricSource?.filenames).toEqual(["generator.scad"]);
  });

  it("leaves an ordinary model without one", () => {
    const meta = makerworldMetaFromDesign(
      designWith([{ modelName: "bracket.stl", modelType: "stl", protected: false }]),
    );

    expect(meta.parametricSource).toBeUndefined();
    expect(makerworldMetaFromDesign({ title: "No extension" }).parametricSource).toBeUndefined();
  });
});

// A design with print profiles downloads one profile's 3MF, which carries no .scad, so the sources need a
// request of their own. It costs one of the account's daily downloads, so it is only made when there is
// something to fetch.

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const designWithProfiles = (modelFiles: unknown[]) => ({
  id: 831106,
  title: "Keychain Creator",
  modelId: "model-1",
  instances: [{ id: "1", profileId: "profile-1" }],
  defaultInstanceId: "1",
  designExtension: { model_files: modelFiles },
});

const SOURCES_PATH = "/model?modelType=all&type=download";

function mockCloud(design: unknown, rawFiles: () => Response): string[] {
  const fetched: string[] = [];
  global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    const url = String(input);
    fetched.push(url);
    if (url.includes(SOURCES_PATH)) return rawFiles();
    if (url.includes("/design-service/design/")) return jsonResponse(200, design);
    if (url.includes("/iot-service/api/user/profile/")) {
      return jsonResponse(200, { message: "success", url: "https://example.com/profile.3mf" });
    }
    return jsonResponse(404, {});
  }) as unknown as typeof fetch;
  return fetched;
}

describe("resolveMakerworldViaCloudApi: generator scripts of a design with print profiles", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("points the import at the sources zip when the creator shared them", async () => {
    const fetched = mockCloud(designWithProfiles([scadFile("keychain.scad", false)]), () =>
      jsonResponse(200, { name: "", url: "https://makerworld.bblmw.com/831106/all.zip?key=k" }),
    );

    const result = await resolveMakerworldViaCloudApi("831106", null, "test-token");

    expect(result?.downloadUrl).toBe("https://example.com/profile.3mf");
    expect(result?.meta.parametricSource).toEqual({
      filenames: ["keychain.scad"],
      withheld: false,
      zipUrl: "https://makerworld.bblmw.com/831106/all.zip?key=k",
    });
    expect(fetched.filter((url) => url.includes(SOURCES_PATH))).toHaveLength(1);
  });

  it("spends no download on sources the creator withheld", async () => {
    const fetched = mockCloud(designWithProfiles([scadFile("panel.scad", true)]), () => {
      throw new Error("the withheld sources must not be requested");
    });

    const result = await resolveMakerworldViaCloudApi("3082544", null, "test-token");

    expect(result?.meta.parametricSource).toEqual({ filenames: ["panel.scad"], withheld: true });
    expect(fetched.some((url) => url.includes(SOURCES_PATH))).toBe(false);
  });

  it("imports the model anyway when the sources request is turned down", async () => {
    mockCloud(designWithProfiles([scadFile("keychain.scad", false)]), () => jsonResponse(403, {}));

    const result = await resolveMakerworldViaCloudApi("831106", null, "test-token");

    expect(result?.downloadUrl).toBe("https://example.com/profile.3mf");
    expect(result?.meta.parametricSource?.zipUrl).toBeNull();
  });

  it("asks for nothing extra for an ordinary model", async () => {
    const fetched = mockCloud(designWithProfiles([{ modelName: "bracket.stl", modelType: "stl" }]), () => {
      throw new Error("a model with no sources must not ask for any");
    });

    const result = await resolveMakerworldViaCloudApi("123", null, "test-token");

    expect(result?.meta.parametricSource).toBeUndefined();
    expect(fetched.some((url) => url.includes(SOURCES_PATH))).toBe(false);
  });
});
