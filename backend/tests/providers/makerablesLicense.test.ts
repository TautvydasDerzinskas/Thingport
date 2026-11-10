import { afterEach, describe, expect, it } from "vitest";
import { resolveMakerablesProject } from "../../src/providers/makerables/api";
import { makerablesLicense } from "../../src/providers/makerables/license";
import { installFetch, json, loadFixture, type FetchStub } from "./support";

// Makerables' licences as its API names them: the seven its public /licenses list offers, recorded from the live
// site, and a project's own, as its detail call embeds it. No database.

let stub: FetchStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

describe("Makerables licences", () => {
  it("maps every licence its list offers by its code", () => {
    const listed = loadFixture("makerables", "licenses").data.data as { code: string; name: string }[];
    expect(listed.map((license) => [license.code, makerablesLicense(license)?.id])).toEqual([
      ["cc_0", "CC0-1.0"],
      ["cc_by_sa", "CC-BY-SA-4.0"],
      ["cc_by_nd", "CC-BY-ND-4.0"],
      ["cc_by_nc_sa", "CC-BY-NC-SA-4.0"],
      ["cc_by_nc", "CC-BY-NC-4.0"],
      ["cc_by", "CC-BY-4.0"],
      ["cc_by_nc_nd", "CC-BY-NC-ND-4.0"],
    ]);
    expect(makerablesLicense(listed[0])).toEqual({ id: "CC0-1.0", raw: "cc_0" });
  });

  it("reads a code it doesn't know by its link or name, and none for a project without one", () => {
    expect(
      makerablesLicense({ code: "cc_by_3", name: "CC BY 3.0", link: "https://creativecommons.org/licenses/by/3.0/" }),
    ).toEqual({ id: "CC-BY-3.0", raw: "cc_by_3" });
    expect(makerablesLicense({ code: "makera_only", name: "Makera Only" })).toEqual({
      id: null,
      raw: "makera_only",
      label: "Makera Only",
    });
    expect(makerablesLicense(null)).toBeNull();
    expect(makerablesLicense({})).toBeNull();
  });

  it("puts the project's licence in its details, and leaves it unread where the answer has no such field", async () => {
    let project = loadFixture("makerables", "project");
    stub = installFetch(({ url }) => (url.pathname === "/api/projects" ? json(project) : undefined));
    expect((await resolveMakerablesProject("acrylic-knife"))?.meta.license).toEqual({
      id: "CC-BY-NC-SA-4.0",
      raw: "cc_by_nc_sa",
    });
    project = loadFixture("makerables", "project");
    project.data.license = null;
    expect((await resolveMakerablesProject("acrylic-knife"))?.meta.license).toBeNull();
    delete project.data.license;
    expect((await resolveMakerablesProject("acrylic-knife"))?.meta).not.toHaveProperty("license");
  });
});
