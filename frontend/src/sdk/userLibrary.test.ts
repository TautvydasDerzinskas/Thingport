import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreeMfFormat } from "../adapter/format.generated";
import type { Plate, Print, PrintProfile, ProfileFilament } from "../api/prints";

const get = vi.fn<(id: string) => Promise<Print>>();
vi.mock("../api/prints", () => ({ printsApi: { get: (id: string) => get(id), fileUrl: (url: string) => url } }));
vi.mock("../api/collections", () => ({ collectionsApi: {} }));
vi.mock("../api/search", () => ({ searchApi: {} }));

const { buildUserLibrary } = await import("./userLibrary");

const plate = (over: Partial<Plate>): Plate => ({
  id: "p",
  print_id: "m1",
  position: 0,
  filename: "part.3mf",
  mime: "model/3mf",
  size: 1,
  url: "/u",
  ...over,
});
const project: ThreeMfFormat = {
  v: 1,
  kind: "prusa",
  app: "PrusaSlicer",
  appVersion: "2.9.0",
  orcaTag: null,
  printer: "Original Prusa MK4",
  nozzle: 0.4,
  filaments: 1,
  filamentList: [{ type: "PETG", color: "#00FF00", brand: "Prusament" }],
  plates: null,
  dialect: null,
};
const profile = (filaments: ProfileFilament[]): PrintProfile => ({
  title: "Site profile",
  description: null,
  origin: "designer",
  creator: null,
  seconds: null,
  grams: null,
  filaments,
  plates: [],
  printer: "P1S",
  nozzle_mm: null,
  layer_mm: null,
  infill: null,
  walls: null,
  supports: null,
});

async function files(plates: Plate[]) {
  get.mockResolvedValue({
    id: "m1",
    name: "m",
    title: "M",
    tags: [],
    created_at: "2026-11-17T00:00:00Z",
    plates,
    preview_images: [],
    supporting_file_count: 0,
    view_count: 0,
    print_count: 0,
    is_favorite: false,
  });
  return (await buildUserLibrary({ openModel: () => undefined }).models.get("m1")).files;
}

describe("a model's files as a script reads them", () => {
  beforeEach(() => get.mockReset());

  it("says which folder each file is in, as one name can be in two", async () => {
    const [top, a, b] = await files([
      plate({ id: "1" }),
      plate({ id: "2", folder: "A" }),
      plate({ id: "3", folder: "USB C/Handles" }),
    ]);
    expect([top.folder, a.folder, b.folder]).toEqual([null, "A", "USB C/Handles"]);
  });

  it("takes a profile's filaments from the project when the provider gave none", async () => {
    const [file] = await files([plate({ profile_id: "42", profile: profile([]), format: project })]);
    expect(file.profile).toMatchObject({ id: "42", name: "Site profile", printer: "P1S" });
    expect(file.profile?.filaments).toEqual([{ type: "PETG", color: "#00FF00", grams: null, brand: "Prusament" }]);
  });

  it("keeps a profile's own filaments where it has them", async () => {
    const [file] = await files([
      plate({ profile_id: "42", profile: profile([{ type: "PLA", color: "#FF0000", grams: 3 }]), format: project }),
    ]);
    expect(file.profile?.filaments).toEqual([{ type: "PLA", color: "#FF0000", grams: 3, brand: null }]);
  });
});
