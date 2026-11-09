import { afterEach, describe, expect, it, vi } from "vitest";
import { eufymakeMetaFromDetail } from "../../src/providers/eufymake/api";
import { eufymakeLicenseFrom, readEufymakeLicense } from "../../src/providers/eufymake/license";
import { licenseById } from "../../src/services/licenseCatalog";
import { loadFixture } from "./support";

// eufyMake's licences as its models' details number them, recorded from its API and checked against the names and
// links its pages show for them. No database.

type Detail = { model_id: string; name: string; license: number };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("eufyMake licences", () => {
  it("knows each number its pages name, CC0 first", () => {
    const read = [1, 2, 3, 4, 5, 6, 7, 8].map((license) => eufymakeLicenseFrom({ license })?.id);
    expect(read).toEqual([
      "CC0-1.0",
      "CC-BY-4.0",
      "CC-BY-SA-4.0",
      "CC-BY-ND-4.0",
      "CC-BY-NC-4.0",
      "CC-BY-NC-SA-4.0",
      "CC-BY-NC-ND-4.0",
      "eufymake-private",
    ]);
    for (const id of read) expect(licenseById(id)).not.toBeNull();
  });

  it("reads each recorded model's licence", () => {
    const details = loadFixture<Detail[]>("eufymake", "license-details");
    expect(Object.fromEntries(details.map((detail) => [detail.model_id, eufymakeLicenseFrom(detail)]))).toEqual({
      "7e215ebad51711efad6f96942a44d98d": { id: "CC0-1.0", raw: "1" },
      "336b3005968411f18659a2365c458327": { id: "CC-BY-4.0", raw: "2" },
      "8c2479d7935d11f1aca35e896f898958": { id: "CC-BY-SA-4.0", raw: "3" },
      "0c4043f38f6c11f1aae2b27ad9738895": { id: "CC-BY-NC-4.0", raw: "5" },
      "9255b7378ac611efa154f2247282c358": { id: "CC-BY-NC-SA-4.0", raw: "6" },
      "9a28d82a6e5411f1aae2b27ad9738895": { id: "eufymake-private", raw: "8" },
    });
  });

  it("puts the licence in the model's details, none for 0, and keeps a number it doesn't know", () => {
    const detail = loadFixture<Detail[]>("eufymake", "license-details").at(-1)!;
    expect(eufymakeMetaFromDetail(detail)!.meta.license).toEqual({ id: "eufymake-private", raw: "8" });
    expect(eufymakeMetaFromDetail({ ...detail, license: 0 })!.meta).toHaveProperty("license", null);
    for (const license of [undefined, null, 0, "0", -1, "", "x"]) expect(eufymakeLicenseFrom({ license })).toBeNull();
    // Kept, allowing nothing, so a mapping that names it later reads it again.
    expect(eufymakeLicenseFrom({ license: 9 })).toEqual({ id: null, raw: "9", label: "eufyMake licence 9" });
  });

  it("reads an older import's licence from its public details, spacing the reads out", async () => {
    const details = loadFixture<Detail[]>("eufymake", "license-details");
    const calls: { at: number; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        calls.push({ at: Date.now(), body, headers: init.headers as Record<string, string> });
        if (!url.endsWith("/model/get_model_detail")) return Response.json({ code: 1, msg: "unexpected" });
        const model = details.find((detail) => detail.model_id === body.model_id);
        return model
          ? Response.json({ code: 0, msg: "success!", data: { model } })
          : Response.json({ code: 220001, msg: "model not exist", data: null });
      }),
    );
    const [first, second, gone] = await Promise.all([
      readEufymakeLicense("user-1", "7e215ebad51711efad6f96942a44d98d"),
      readEufymakeLicense("user-1", "9a28d82a6e5411f1aae2b27ad9738895"),
      readEufymakeLicense("user-1", "00000000000000000000000000000000"),
    ]);
    expect([first, second, gone]).toEqual([{ id: "CC0-1.0", raw: "1" }, { id: "eufymake-private", raw: "8" }, null]);
    expect(calls.map((call) => call.body.model_id)).toEqual([
      "7e215ebad51711efad6f96942a44d98d",
      "9a28d82a6e5411f1aae2b27ad9738895",
      "00000000000000000000000000000000",
    ]);
    // A burst of more than a few calls a second is turned away.
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(650);
    expect(calls[2].at - calls[1].at).toBeGreaterThanOrEqual(650);
    expect(calls[0].headers).not.toHaveProperty("X-Auth-Token");
  });
});
