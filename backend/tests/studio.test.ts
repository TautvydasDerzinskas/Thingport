import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import JSZip from "jszip";
import { readBambuPackage, readBambuModels } from "../src/adapter/readers/bambuProject";

import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { DEFAULT_MCP_TOOL_NAMES, MCP_TOOLS } from "../src/mcp/tools";
import { STUDIO_COMMAND_LIST } from "../src/studio/commands.generated";
import { decodeMesh } from "../src/studio/meshAsset.generated";
import { resolvePlateFilePath } from "../src/services/printCreation";
import { studioAssetDir } from "../src/services/studioService";

// Studio end to end: designs are their owner's, every change is a command kept as a revision, and every command is
// an MCP tool an assistant can run the same way.

const app = createApp();
const STUDIO_TOOLS = MCP_TOOLS.filter((tool) => tool.group === "studio").map((tool) => tool.name);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function register(label: string): Promise<string> {
  const email = `studio-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: `Studio ${label}`, email, password: "password123" });
  if (res.status !== 200) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

function readBinary(res: NodeJS.ReadableStream, done: (error: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => done(null, Buffer.concat(chunks)));
}

async function command(session: string, id: string, name: string, args: Record<string, unknown> = {}) {
  return request(app).post(`/api/studio/designs/${id}/commands`).set(auth(session)).send({ command: name, args });
}

/** An API token that may use Studio's MCP tools. */
async function mcpToken(session: string): Promise<string> {
  const res = await request(app)
    .post("/api/profile/api-token")
    .set(auth(session))
    .send({ mcp_tools: [...DEFAULT_MCP_TOOL_NAMES, ...STUDIO_TOOLS] });
  return res.body.token as string;
}

let nextRpc = 1;
async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/mcp")
    .set("Accept", "application/json, text/event-stream")
    .set(auth(token))
    .send({ jsonrpc: "2.0", id: nextRpc++, method: "tools/call", params: { name, arguments: args } });
  expect(res.status).toBe(200);
  const result = res.body.result as { isError?: boolean; content: { type: string; text?: string; data?: string }[] };
  const text = result.content[0]?.text ?? "";
  return {
    isError: Boolean(result.isError),
    text,
    data: result.isError ? null : JSON.parse(text),
    content: result.content,
  };
}

describe("Studio", () => {
  let alice: string;
  let bob: string;
  beforeAll(async () => {
    // One after the other: on a new instance the first account is its admin, and a second at the same time is turned away.
    alice = await register("alice");
    bob = await register("bob");
  });

  it("uses the same printer setup for MCP print checks and arrangement and writes selected filament slots", async () => {
    const design = (await request(app).post("/api/studio/designs").set(auth(alice)).send({ name: "Print workflow" }))
      .body;
    const token = await mcpToken(alice);
    const tool = (name: string, args: Record<string, unknown> = {}) =>
      callTool(token, `studio_${name}`, { design_id: design.id, ...args });
    const setup = { printer: "bambulab-p1s", nozzle: "0.4", bed: [24, 24, 256], minWall: 0.8 };
    expect((await command(alice, design.id, "set_print_setup", { setup })).status).toBe(200);
    const savedPrinter = await request(app)
      .put("/api/me/printers/bambulab-p1s")
      .set(auth(alice))
      .send({ nozzle: "0.6" });
    expect(savedPrinter.body.nozzle).toBe("0.6");
    expect(savedPrinter.body.exact_nozzles.orcaslicer).toContain("0.4");
    const shape = { width: 14, depth: 14, height: 4 };
    const red = (await tool("add_box", { ...shape, color: "#ff0000" })).data.created[0];
    const blue = (await tool("add_box", { ...shape, color: "#0000ff", position: [30, 0, 0] })).data.created[0];
    const check = (await tool("check_print")).data;
    expect(check.printer).toBe(setup.printer);
    expect(check.bodies).toMatchObject([
      { id: red, fitsBed: true },
      { id: blue, fitsBed: false },
    ]);
    expect((await tool("lock_plate_positions", { feature_ids: [red], locked: true })).isError).toBe(false);
    expect((await tool("arrange_plate", { plate_id: "plate-1" })).isError).toBe(true);
    expect((await tool("arrange_plate", { plate_id: "plate-1", overflow: true })).data.created).toEqual(["plate-2"]);
    expect((await tool("check_print")).data.ready).toBe(true);

    expect(
      (
        await tool("set_filament_slots", {
          slots: [
            { color: "#ff0000", slot: 3, material: "PETG" },
            { color: "#0000ff", slot: 1, material: "PLA" },
          ],
        })
      ).isError,
    ).toBe(false);
    const file = await request(app)
      .get(`/api/studio/designs/${design.id}/export/3mf/orcaslicer/bambulab-p1s/0.4/-/Workflow.3mf`)
      .set(auth(alice))
      .buffer(true)
      .parse(readBinary);
    expect(file.status).toBe(200);
    const pkg = await readBambuPackage(file.body);
    expect(pkg.config.filament_colour).toEqual(["#0000FF", "#B0B0B0", "#FF0000"]);
    expect(pkg.config.filament_type).toEqual(["PLA", "PLA", "PETG"]);
    expect(pkg.config.printer_settings_id).toBe("Bambu Lab P1S 0.4 nozzle");
    expect(Object.values(pkg.modelSettings).map(({ extruder }) => extruder)).toEqual([3, 1]);
    const missingNozzle = await request(app)
      .get(`/api/studio/designs/${design.id}/export/3mf/orcaslicer/bambulab-p1s/0.7/-/Workflow.3mf`)
      .set(auth(alice));
    expect(missingNozzle.status).toBe(400);
  });

  it("measures fit samples against the saved bed before writing a revision", async () => {
    const design = (await request(app).post("/api/studio/designs").set(auth(alice)).send({ name: "Fit samples" })).body;
    const { id } = design;
    await command(alice, id, "add_box", { width: 40, depth: 30, height: 20 });
    const split = await command(alice, id, "split", {
      feature_id: "box-1",
      plane: { point: [0, 0, 10], normal: [0, 0, 1] },
      connector: { diameter: 3, depth: 3, clearance: 0.2, offset: [0, 0], count: 1, spacing: 10 },
    });
    expect(split.status).toBe(200);
    const setup = { printer: "small-bed", nozzle: "0.4", bed: [12, 12, 20], minWall: 0.8 };
    const chosen = await command(alice, id, "set_print_setup", { setup });
    const args = { feature_id: split.body.created[0], clearances: [0.2] };
    const refused = await command(alice, id, "make_fit_test", args);
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe("studio_fit_outside");
    const persisted = await request(app).get(`/api/studio/designs/${id}`).set(auth(alice));
    expect(persisted.body.version).toBe(chosen.body.design.version);
    expect(persisted.body.document.plates).toBeUndefined();
    await command(alice, id, "set_print_setup", { setup: { ...setup, bed: [50, 50, 20] } });
    const created = await command(alice, id, "make_fit_test", args);
    expect(created.status).toBe(200);
    expect(created.body.created).toHaveLength(2);
    expect(created.body.design.document.plates.at(-1).name).toBe("Fit test");
  });

  it("keeps saved circular beds and catalogue outlines in exported 3MF settings", async () => {
    const { body: design } = await request(app)
      .post("/api/studio/designs")
      .set(auth(alice))
      .send({ name: "Printer outlines" });
    await command(alice, design.id, "add_box", { width: 12, depth: 12, height: 4 });
    const setup = {
      printer: "flsun-q5",
      nozzle: "0.4",
      bed: [200, 200, 200],
      minWall: 0.8,
      outline: { shape: "circle" },
    };
    expect((await command(alice, design.id, "set_print_setup", { setup })).status).toBe(200);
    async function exportArea(target: string) {
      const response = await request(app)
        .get(`/api/studio/designs/${design.id}/export/3mf/${target}/-/Outline.3mf`)
        .set(auth(alice))
        .buffer(true)
        .parse(readBinary);
      expect(response.status).toBe(200);
      const project = await readBambuPackage(response.body);
      return (project.config.printable_area as string[]).map((point) => point.split("x").map(Number));
    }
    const saved = await exportArea("-/-/-");
    expect(saved.length).toBeGreaterThan(4);
    for (const [x, y] of saved) expect(Math.hypot(x - 100, y - 100)).toBeCloseTo(100, 5);
    const circle = await exportArea("orcaslicer/flsun-q5/0.4");
    expect(circle.length).toBeGreaterThan(4);
    for (const [x, y] of circle) expect(Math.hypot(x, y)).toBeCloseTo(100, 5);
    const polygon = await exportArea("orcaslicer/deltamaker-2/0.35");
    expect(polygon).toEqual([
      [-69, -120],
      [-138, 0],
      [-69, 120],
      [69, 120],
      [138, 0],
      [69, -120],
    ]);
  });

  it("refuses a seventeenth filament and reuses an inactive assignment's slot", async () => {
    const design = (await request(app).post("/api/studio/designs").set(auth(alice)).send({ name: "Filament limit" }))
      .body;
    const colors = Array.from({ length: 17 }, (_, i) => `#${(i + 1).toString(16).padStart(6, "0")}`);
    for (const [i, color] of colors.entries()) {
      expect(
        (await command(alice, design.id, "add_box", { width: 2, depth: 2, height: 2, color, position: [5 * i, 0, 0] }))
          .status,
      ).toBe(200);
    }
    expect(
      (
        await command(alice, design.id, "set_filament_slots", {
          slots: colors.slice(0, 16).map((color, i) => ({ color, slot: i + 1, material: "PLA" })),
        })
      ).status,
    ).toBe(200);
    const url = `/api/studio/designs/${design.id}/export/3mf/orcaslicer/-/-/-/Filament.3mf`;
    const refused = await request(app).get(url).set(auth(alice));
    expect(refused.status).toBe(422);
    expect(refused.body.detail).toMatch(/16 filament slots/);
    await command(alice, design.id, "set_visibility", { feature_id: "box-1", visible: false });
    const exported = await request(app).get(url).set(auth(alice)).buffer(true).parse(readBinary);
    expect(exported.status).toBe(200);
    const pkg = await readBambuPackage(exported.body);
    expect(pkg.config.filament_colour).toHaveLength(16);
    expect(pkg.config.filament_colour?.[0]).toBe(colors[16].toUpperCase());
  });

  it("says it's on, and keeps each user's designs to themselves", async () => {
    expect((await request(app).get("/api/studio/status").set(auth(alice))).body).toEqual({ enabled: true });
    const created = await request(app).post("/api/studio/designs").set(auth(alice)).send({ name: "Bracket" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Bracket", version: 0, can_undo: false, can_redo: false });
    expect(created.body.document).toEqual({ version: 1, features: [], next_id: 1, units: "mm" });

    const mine = await request(app).get("/api/studio/designs").set(auth(alice));
    expect(mine.body.map((design: { id: string }) => design.id)).toContain(created.body.id);
    expect((await request(app).get(`/api/studio/designs/${created.body.id}`).set(auth(bob))).status).toBe(404);
    expect((await command(bob, created.body.id, "add_box", { width: 1, depth: 1, height: 1 })).status).toBe(404);
    expect((await request(app).delete(`/api/studio/designs/${created.body.id}`).set(auth(bob))).status).toBe(404);
  });

  it("runs commands, refuses ones it can't carry out, and undoes and redoes them", async () => {
    const { body: design } = await request(app).post("/api/studio/designs").set(auth(alice)).send({});
    expect(design.name).toBe("Untitled design");

    const added = await command(alice, design.id, "add_box", { width: 20, depth: 10, height: 5 });
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ created: ["box-1"], design: { version: 1, can_undo: true, can_redo: false } });

    const refused = await command(alice, design.id, "update_feature", { feature_id: "box-1", radius: 3 });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: "studio_command_refused", detail: expect.stringMatching(/no radius/) });
    expect((await command(alice, design.id, "no_such_command")).status).toBe(400);

    await command(alice, design.id, "add_cylinder", { radius: 3, height: 10 });
    const undone = await command(alice, design.id, "undo");
    expect(undone.body.summary).toMatch(/^Undid: Added cylinder-2/);
    expect(undone.body.design.document.features.map((f: { id: string }) => f.id)).toEqual(["box-1"]);
    expect(undone.body.design.can_redo).toBe(true);

    const redone = await command(alice, design.id, "redo");
    expect(redone.body.design.document.features).toHaveLength(2);
    await command(alice, design.id, "undo");
    // A new change after an undo leaves nothing to redo.
    const changed = await command(alice, design.id, "set_visibility", { feature_id: "box-1", visible: false });
    expect(changed.body.design.can_redo).toBe(false);
    expect((await command(alice, design.id, "redo")).body.detail).toMatch(/nothing to redo/);

    const renamed = await command(alice, design.id, "rename_design", { name: "Shelf clip" });
    expect(renamed.body.design.name).toBe("Shelf clip");
    const version = await request(app).get(`/api/studio/designs/${design.id}/version`).set(auth(alice));
    expect(version.body).toEqual({ version: renamed.body.design.version });
  });

  it("writes text in Thingport's fonts, and says which fonts have a letter one hasn't", async () => {
    const { body: design } = await request(app).post("/api/studio/designs").set(auth(alice)).send({});
    const written = await command(alice, design.id, "add_text", { text: "Ąžuolas", size: 8, height: 1.5, plane: "XY" });
    expect(written.status).toBe(200);
    expect(written.body.created).toEqual(["sketch-1", "extrude-2"]);
    expect(written.body.summary).toMatch(/^Wrote “Ąžuolas” in PT Sans, letters 8 mm tall and 1.5 mm high/);
    const refused = await command(alice, design.id, "add_text", {
      text: "Ąžuolas",
      size: 8,
      height: 1,
      plane: "XY",
      font: "arvo",
    });
    expect(refused.status).toBe(400);
    expect(refused.body.detail).toMatch(/Arvo has no letter for “Ą”.*PT Sans/);
    // The server makes it in the same fonts: a solid, as tall as asked.
    const read = await callTool(await mcpToken(alice), "studio_get_design", { design_id: design.id });
    expect(read.data.problems).toEqual([]);
    const [body] = read.data.bodies as { bounds: { min: number[]; max: number[] } }[];
    expect(body.bounds.max[2] - body.bounds.min[2]).toBeCloseTo(1.5);
  });

  it("keeps pictures with a design, traces one into a solid, and traces it again", async () => {
    const { body: design } = await request(app).post("/api/studio/designs").set(auth(alice)).send({});
    // A black ring on white, 200 px across.
    const size = 200;
    const pixels = Buffer.alloc(size * size, 255);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const r = Math.hypot(x + 0.5 - 100, y + 0.5 - 100);
        if (r > 50 && r < 90) pixels[y * size + x] = 0;
      }
    const png = await sharp(pixels, { raw: { width: size, height: size, channels: 1 } })
      .png()
      .toBuffer();
    const kept = await request(app)
      .post(`/api/studio/designs/${design.id}/pictures`)
      .set(auth(alice))
      .set("Content-Type", "image/png")
      .send(png);
    expect(kept.status).toBe(201);
    expect(kept.body).toMatchObject({ id: expect.stringMatching(/^[0-9a-f]{24}$/), width: 200, height: 200 });
    expect(
      (await request(app).get(`/api/studio/designs/${design.id}/pictures/${kept.body.id}`).set(auth(bob))).status,
    ).toBe(404);
    const shown = await request(app).get(`/api/studio/designs/${design.id}/pictures/${kept.body.id}`).set(auth(alice));
    expect(shown.status).toBe(200);
    expect(shown.headers["content-type"]).toMatch(/image\/png/);
    const junk = await request(app)
      .post(`/api/studio/designs/${design.id}/pictures`)
      .set(auth(alice))
      .set("Content-Type", "image/png")
      .send(Buffer.from("not a picture"));
    expect(junk.status).toBe(415);

    const traced = await command(alice, design.id, "trace_picture", {
      picture_id: kept.body.id,
      width: 36,
      plane: "XY",
      height: 2,
    });
    expect(traced.status).toBe(200);
    expect(traced.body.summary).toMatch(/^Traced the picture into sketch-1: 2 shapes \(1 of them holes\), 36 × 36 mm/);
    const read = await callTool(await mcpToken(alice), "studio_get_design", { design_id: design.id });
    expect(read.data.problems).toEqual([]);
    // The outline is said in a line, not sent point by point.
    expect(read.data.features[0].shapes[0].outline).toMatch(/^\(2 outlines, \d+ points\)$/);
    // A ring 36 mm across with a hole 20 mm across, 2 mm high.
    const volume = Math.PI * (18 ** 2 - 10 ** 2) * 2;
    expect(read.data.bodies[0].volume_mm3).toBeGreaterThan(volume * 0.95);
    expect(read.data.bodies[0].volume_mm3).toBeLessThan(volume * 1.05);

    const { body: otherPlate } = await command(alice, design.id, "create_plate", { name: "Another plate" });
    const conflict = await command(alice, design.id, "trace_picture", {
      picture_id: kept.body.id,
      width: 18,
      sketch_id: "sketch-1",
      index: 0,
      plate_id: otherPlate.created[0],
    });
    expect(conflict.status).toBe(400);
    expect(conflict.body.detail).toMatch(/sketch-1 is on plate-1/);
    const again = await command(alice, design.id, "trace_picture", {
      picture_id: kept.body.id,
      width: 18,
      sketch_id: "sketch-1",
      index: 0,
      plate_id: "plate-1",
    });
    expect(again.status).toBe(200);
    expect(again.body.design.document.features[0].shapes[0]).toMatchObject({ type: "trace", width: 18, height: 18 });
    const missing = await command(alice, design.id, "trace_picture", {
      picture_id: "f".repeat(24),
      width: 5,
      plane: "XY",
    });
    expect(missing.status).toBe(400);
  });

  it("exports only populated plates with colored thumbnails in an adapted project", async () => {
    const { body: design } = await request(app)
      .post("/api/studio/designs")
      .set(auth(alice))
      .send({ name: "Two plates" });
    const token = await mcpToken(alice);
    const tool = (name: string, args = {}) => callTool(token, `studio_${name}`, { design_id: design.id, ...args });
    const empty = (await tool("create_plate", { name: "Spare" })).data.created[0];
    const plate = (await tool("create_plate", { name: "Lids" })).data.created[0];
    const box = { width: 12, depth: 12, height: 5 };
    const red = (await tool("add_box", { ...box, color: "#ff0000" })).data.created[0];
    const blue = (await tool("add_box", box)).data.created[0];
    expect((await tool("set_body_color", { feature_ids: [blue], color: "#0000FF" })).isError).toBe(false);
    expect((await tool("move_to_plate", { feature_ids: [blue], plate_id: plate })).isError).toBe(false);
    expect((await tool("check_print")).data.overlaps).toEqual([]);
    const state = (await tool("get_design")).data;
    expect(state.plates).toEqual([
      { id: "plate-1", name: "Plate 1", feature_ids: [red] },
      { id: empty, name: "Spare", feature_ids: [] },
      { id: plate, name: "Lids", feature_ids: [blue] },
    ]);
    expect(state.bodies).toMatchObject([
      { id: red, color: "#ff0000", plate_id: "plate-1" },
      { id: blue, color: "#0000ff", plate_id: plate },
    ]);
    expect((await tool("undo")).isError).toBe(false);
    expect((await tool("get_design")).data.plates[2].feature_ids).toEqual([]);
    expect((await tool("redo")).isError).toBe(false);

    const exportPath = `/studio/designs/${design.id}/export/3mf/orcaslicer/bambulab-p1s/0.4/-/Two.3mf`;
    expect((await request(app).get(`/api${exportPath}`).set(auth(bob))).status).toBe(404);
    const before = await prisma.print.count();
    const file = await request(app)
      .get(`/api/t/${encodeURIComponent(alice)}${exportPath}`)
      .buffer(true)
      .parse(readBinary);
    expect(file.status).toBe(200);
    expect(await prisma.print.count()).toBe(before);
    const pkg = await readBambuPackage(file.body);
    expect(pkg.plates.map(({ id, name, instances }) => [id, name, instances.length])).toEqual([
      ["1", "Plate 1", 1],
      ["2", "Lids", 1],
    ]);
    expect(pkg.modelSettingsXml?.match(/key="thumbnail_file" value="[^"]+"/g)).toEqual([
      'key="thumbnail_file" value="Metadata/plate_1.png"',
      'key="thumbnail_file" value="Metadata/plate_2.png"',
    ]);
    expect(pkg.zip.file("Metadata/plate_3.png")).toBeNull();
    expect(await pkg.zip.file("_rels/.rels")!.async("string")).toContain('Target="/Metadata/plate_1.png"');
    const redThumb = await sharp(await pkg.zip.file("Metadata/plate_1.png")!.async("nodebuffer")).stats();
    const blueThumb = await sharp(await pkg.zip.file("Metadata/plate_2.png")!.async("nodebuffer")).stats();
    expect(redThumb.channels[0].max).toBeGreaterThan(0);
    expect(redThumb.channels[2].max).toBe(0);
    expect(blueThumb.channels[0].max).toBe(0);
    expect(blueThumb.channels[2].max).toBeGreaterThan(0);
    expect(pkg.config).toMatchObject({
      printer_settings_id: "Bambu Lab P1S 0.4 nozzle",
      filament_colour: ["#FF0000", "#0000FF"],
    });
    const models = await readBambuModels(pkg);
    expect(models["3d/3dmodel.model"].buildItems).toHaveLength(2);
    expect(Object.values(pkg.modelSettings).map((obj) => obj.extruder)).toEqual([1, 2]);

    const prusa = `/api/studio/designs/${design.id}/export/3mf/prusaslicer/-/-`;
    expect((await request(app).get(`${prusa}/-/Two.3mf`).set(auth(alice))).status).toBe(400);
    const single = await request(app).get(`${prusa}/${plate}/Lids.3mf`).set(auth(alice)).buffer(true).parse(readBinary);
    expect(single.status).toBe(200);
    const zip = await JSZip.loadAsync(single.body);
    expect(await zip.file("Metadata/thumbnail.png")!.async("nodebuffer")).toEqual(
      await pkg.zip.file("Metadata/plate_2.png")!.async("nodebuffer"),
    );
    const mesh = await zip.file("3D/3dmodel.model")!.async("string");
    expect(mesh).toMatch(/#0000ff/i);
    expect(mesh).not.toMatch(/#ff0000/i);
  });

  it("saves a design to the library: its 3MF, its picture, and what was asked as its description", async () => {
    const { body: design } = await request(app).post("/api/studio/designs").set(auth(alice)).send({ name: "Tag" });
    const empty = await request(app).post(`/api/studio/designs/${design.id}/save-to-library`).set(auth(alice)).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe("studio_save_empty");

    await command(alice, design.id, "add_box", { width: 30, depth: 20, height: 4 });
    await prisma.studioMessage.createMany({
      data: [
        { designId: design.id, role: "user", text: "Make a tag" },
        { designId: design.id, role: "assistant", text: "Made it." },
        { designId: design.id, role: "user", text: "Make it 4 mm thick" },
      ],
    });
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#336699" } })
      .png()
      .toBuffer();
    const picture = await request(app)
      .post(`/api/studio/designs/${design.id}/pictures`)
      .set(auth(alice))
      .set("Content-Type", "image/png")
      .send(png);
    expect(
      (await request(app).post(`/api/studio/designs/${design.id}/save-to-library`).set(auth(bob)).send({})).status,
    ).toBe(404);
    const saved = await request(app)
      .post(`/api/studio/designs/${design.id}/save-to-library`)
      .set(auth(alice))
      .send({ picture_id: picture.body.id });
    expect(saved.status).toBe(201);
    const model = saved.body.model;
    expect(model.title).toBe("Tag");
    expect(model.notes).toBe("- Make a tag\n- Make it 4 mm thick");
    expect(model.plates.map((plate: { filename: string }) => plate.filename)).toEqual(["Tag.3mf"]);
    expect(model.preview_images).toHaveLength(1);
    const plate = await prisma.plate.findFirstOrThrow({ where: { printId: model.id } });
    const project = await readBambuPackage(fs.readFileSync(resolvePlateFilePath(plate)!));
    expect(project.plates).toHaveLength(1);
    expect(project.zip.file("Metadata/plate_1.png")).not.toBeNull();
    const download = await request(app)
      .get(`/api/studio/designs/${design.id}/export/auto/-/-/-/-/Tag.stl`)
      .set(auth(alice))
      .buffer(true)
      .parse(readBinary);
    expect(download.status).toBe(200);
    expect(download.headers["content-disposition"]).toContain("Tag.stl");
    expect(download.body.readUInt32LE(80)).toBe(12);

    // An assistant saves it too, and the server pictures it.
    const token = await mcpToken(alice);
    const viaMcp = await callTool(token, "studio_save_to_library", { design_id: design.id, name: "Tag again" });
    expect(viaMcp.data).toMatchObject({ name: "Tag again", model_id: expect.any(String) });
    const again = await prisma.print.findUnique({
      where: { id: viaMcp.data.model_id },
      include: { previewImages: true },
    });
    expect(again?.previewImages).toHaveLength(1);
  });

  it("keeps each person's Studio settings: where the assistant shows, and the units new designs start in", async () => {
    const settings = (session: string) => request(app).get("/api/studio/settings").set(auth(session));
    const grid = { show: true, spacing: "adaptive", density: "normal", major: 10, subdivisions: 10, snap: true };
    expect((await settings(bob)).body).toEqual({ prompt_layout: "bar", units: "mm", grid });
    const set = await request(app).patch("/api/studio/settings").set(auth(bob)).send({ prompt_layout: "panel" });
    expect(set.body).toMatchObject({ prompt_layout: "panel", units: "mm" });
    await request(app).patch("/api/studio/settings").set(auth(bob)).send({ units: "in" });
    expect((await settings(bob)).body).toMatchObject({ prompt_layout: "panel", units: "in" });
    expect((await settings(alice)).body).toEqual({ prompt_layout: "bar", units: "mm", grid });
    // The grid's settings change one by one, each keeping the rest.
    await request(app)
      .patch("/api/studio/settings")
      .set(auth(bob))
      .send({ grid: { spacing: "fixed", major: 25.4 } });
    await request(app)
      .patch("/api/studio/settings")
      .set(auth(bob))
      .send({ grid: { snap: false } });
    expect((await settings(bob)).body.grid).toEqual({ ...grid, spacing: "fixed", major: 25.4, snap: false });
    expect(
      (
        await request(app)
          .patch("/api/studio/settings")
          .set(auth(bob))
          .send({ grid: { subdivisions: 0 } })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch("/api/studio/settings")
          .set(auth(bob))
          .send({ grid: { density: "dense" } })
      ).status,
    ).toBe(400);
    expect((await request(app).patch("/api/studio/settings").set(auth(bob)).send({ units: "ft" })).status).toBe(400);
    expect((await request(app).patch("/api/studio/settings").set(auth(bob)).send({ layout: "panel" })).status).toBe(
      400,
    );

    // A new design starts in them; an assistant can say otherwise, and anyone can change a design's own.
    const { body: inches } = await request(app).post("/api/studio/designs").set(auth(bob)).send({});
    expect(inches.document.units).toBe("in");
    const token = await mcpToken(bob);
    const metric = await callTool(token, "studio_create_design", { units: "cm" });
    const read = await callTool(token, "studio_get_design", { design_id: metric.data.design_id });
    expect(read.data).toMatchObject({ units: "mm", display_units: "cm", parameters: [] });
    const switched = await command(bob, inches.id, "set_units", { units: "mm" });
    expect(switched.body.design.document.units).toBe("mm");
    expect((await command(bob, inches.id, "undo")).body.design.document.units).toBe("in");

    // A formula typed in an inch design keeps its inches, and get_design lists parameters with their units.
    await command(bob, inches.id, "add_box", { width: 10, depth: 10, height: 10 });
    await command(bob, inches.id, "set_parameter", { name: "side", value: 1, unit: "in" });
    const followed = await command(bob, inches.id, "set_expression", {
      feature_id: "box-1",
      field: "width",
      expression: "side + 0.5",
    });
    expect(followed.body.summary).toBe("box-1's width follows side + 0.5 in: it's 38.1");
    const state = await callTool(token, "studio_get_design", { design_id: inches.id });
    expect(state.data.parameters).toEqual([{ name: "side", value: 1, unit: "in" }]);
    await request(app).patch("/api/studio/settings").set(auth(bob)).send({ prompt_layout: "bar", units: "mm", grid });
  });

  it("applies commands sent at once one after another, so none is lost", async () => {
    const { body: design } = await request(app).post("/api/studio/designs").set(auth(alice)).send({});
    await Promise.all(Array.from({ length: 6 }, () => command(alice, design.id, "add_sphere", { radius: 2 })));
    const { body } = await request(app).get(`/api/studio/designs/${design.id}`).set(auth(alice));
    expect(body.document.features).toHaveLength(6);
    expect(body.version).toBe(6);
  });

  it("places, repeats and checks bodies for an assistant, measuring them on the server", async () => {
    const token = await mcpToken(alice);
    const id = (await callTool(token, "studio_create_design", { name: "Stand" })).data.design_id as string;
    await callTool(token, "studio_add_box", { design_id: id, width: 40, depth: 30, height: 10 });
    await callTool(token, "studio_add_cylinder", { design_id: id, radius: 4, height: 6, position: [-50, 20, 7] });

    // On top of the box and centred on it: touching, not overlapping, and floating once it's printed alone.
    const aligned = await callTool(token, "studio_align", {
      design_id: id,
      feature_id: "cylinder-2",
      to_id: "box-1",
      x: "center",
      y: "center",
      z: "after",
    });
    expect(aligned.data.problems).toEqual([]);
    const between = await callTool(token, "studio_measure", { design_id: id, a_id: "cylinder-2", b_id: "box-1" });
    expect(between.data).toMatchObject({ gap_mm: 0, overlap_mm3: 0, touching: true });
    expect(between.data["cylinder-2"].min).toEqual([-4, -4, 10]);
    const floating = await callTool(token, "studio_check_print", { design_id: id });
    expect(floating.data).toMatchObject({
      ready: false,
      problems: [expect.stringMatching(/cylinder-2 is floating 10 mm/)],
    });

    await callTool(token, "studio_boolean", {
      design_id: id,
      operation: "union",
      target_id: "box-1",
      tool_ids: ["cylinder-2"],
    });
    const joined = await callTool(token, "studio_check_print", { design_id: id, bed: [180, 180, 180] });
    expect(joined.data).toMatchObject({ ready: true, problems: [] });
    expect(joined.data.bodies[0]).toMatchObject({ id: "boolean-3", fitsBed: true, pieces: 1 });

    // Four in a row is one body, 3 × 50 mm wider: too wide now for a 180 mm bed, and in four pieces 10 mm apart.
    await callTool(token, "studio_linear_pattern", { design_id: id, feature_id: "boolean-3", count: 4, spacing: 50 });
    const row = await callTool(token, "studio_check_print", { design_id: id, bed: [180, 180, 180] });
    expect(row.data.bodies[0].size[0]).toBeCloseTo(190);
    expect(row.data.problems).toEqual([
      expect.stringMatching(/pattern-4 doesn't fit the 180 × 180 × 180 mm bed/),
      expect.stringMatching(/pattern-4 is in 4 loose pieces/),
    ]);

    // Laid flat on a tilted face, over REST as the page runs it: the server measures where it comes to rest.
    const { body: tilted } = await request(app).post("/api/studio/designs").set(auth(alice)).send({});
    await command(alice, tilted.id, "add_box", {
      width: 20,
      depth: 10,
      height: 6,
      rotation: [0, 30, 0],
      position: [5, 0, 8],
    });
    const inspected = await callTool(token, "studio_inspect_body", { design_id: tilted.id, feature_id: "box-1" });
    const face = inspected.data.faces.find(
      (each: { normal: number[] }) => each.normal[2] < -0.5 && Math.abs(each.normal[1]) < 0.01,
    );
    const flat = await command(alice, tilted.id, "lay_flat", {
      feature_id: "box-1",
      face: { point: face.point, normal: face.normal },
    });
    expect(flat.status).toBe(200);
    const laid = await callTool(token, "studio_get_design", { design_id: tilted.id });
    const size = laid.data.bodies[0].size as number[];
    [20, 10, 6].forEach((side, axis) => expect(size[axis]).toBeCloseTo(side, 2));
    expect((await callTool(token, "studio_check_print", { design_id: tilted.id })).data.ready).toBe(true);

    // A tapped hole keeps its ISO pitch with it.
    await command(alice, tilted.id, "hole", {
      feature_id: "box-1",
      point: [5, 0, 6],
      normal: [0, 0, 1],
      diameter: 5,
      thread: {},
    });
    const tapped = await request(app).get(`/api/studio/designs/${tilted.id}`).set(auth(alice));
    expect(tapped.body.document.features.at(-1)).toMatchObject({ type: "hole", thread: { pitch: 0.8 } });
  });

  it("offers every command as an MCP tool, off until the user turns Studio on", async () => {
    for (const each of STUDIO_COMMAND_LIST) expect(STUDIO_TOOLS).toContain(`studio_${each.name}`);
    expect(DEFAULT_MCP_TOOL_NAMES.some((name) => name.startsWith("studio_"))).toBe(false);

    const res = await request(app)
      .post("/api/profile/api-token")
      .set(auth(alice))
      .send({ mcp_tools: [...DEFAULT_MCP_TOOL_NAMES, ...STUDIO_TOOLS] });
    const token = res.body.token as string;
    const listed = await request(app)
      .post("/api/mcp")
      .set(auth(token))
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: nextRpc++, method: "tools/list", params: {} });
    const tools = listed.body.result.tools as { name: string; annotations?: { destructiveHint?: boolean } }[];
    for (const name of [
      "update_split_connector",
      "apply_fit_clearance",
      "set_print_setup",
      "lock_plate_positions",
      "arrange_plate",
      "rename_plate",
      "move_to_plate",
      "set_body_color",
      "set_filament_slots",
    ]) {
      expect(tools.find((tool) => tool.name === `studio_${name}`)?.annotations).toMatchObject({
        destructiveHint: true,
      });
    }
    for (const name of ["create_plate", "make_fit_test"]) {
      expect(tools.find((tool) => tool.name === `studio_${name}`)?.annotations).toMatchObject({
        destructiveHint: false,
      });
    }

    const created = await callTool(token, "studio_create_design", { name: "From an assistant" });
    const id = created.data.design_id as string;
    expect(
      (await callTool(token, "studio_add_box", { design_id: id, width: 20, depth: 20, height: 10 })).data,
    ).toMatchObject({
      done: expect.stringContaining("box-1"),
      created: ["box-1"],
    });
    await callTool(token, "studio_add_cylinder", { design_id: id, radius: 5, height: 30, position: [0, 0, -5] });
    await callTool(token, "studio_boolean", {
      design_id: id,
      operation: "subtract",
      target_id: "box-1",
      tool_ids: ["cylinder-2"],
    });
    const refused = await callTool(token, "studio_delete_feature", { design_id: id, feature_id: "box-1" });
    expect(refused).toMatchObject({ isError: true, text: expect.stringMatching(/part of boolean-3/) });

    const read = await callTool(token, "studio_get_design", { design_id: id });
    expect(read.data).toMatchObject({ units: "mm", up: "+Z", top_level: ["boolean-3"], problems: [] });
    expect(read.data.bodies[0].size).toEqual([20, 20, 10]);
    expect(read.data.bodies[0].volume_mm3).toBeLessThan(4000);
    expect(read.data.recent_changes[0]).toMatchObject({ by: "mcp", summary: expect.stringContaining("boolean-3") });

    const view = await callTool(token, "studio_view_design", { design_id: id, views: ["iso", "top"], size: 128 });
    expect(view.isError).toBe(false);
    expect(view.content.filter((part) => part.type === "image")).toHaveLength(2);
    const emptyPlate = await callTool(token, "studio_view_design", { design_id: id, plate_id: "" });
    expect(emptyPlate).toMatchObject({ isError: true, text: expect.stringMatching(/plate doesn't belong/) });

    // The page sees what the assistant did.
    const page = await request(app).get(`/api/studio/designs/${id}`).set(auth(alice));
    expect(page.body.document.features.map((f: { id: string }) => f.id)).toEqual(["box-1", "cylinder-2", "boolean-3"]);
  });

  it("lets an assistant read the guide, name edges from inspect_body, and round, drill and split with them", async () => {
    const res = await request(app)
      .post("/api/profile/api-token")
      .set(auth(alice))
      .send({ mcp_tools: [...DEFAULT_MCP_TOOL_NAMES, ...STUDIO_TOOLS] });
    const token = res.body.token as string;
    expect((await callTool(token, "studio_guide")).data.guide).toMatch(/Naming faces and edges/);

    const id = (await callTool(token, "studio_create_design", {})).data.design_id as string;
    await callTool(token, "studio_add_box", { design_id: id, width: 40, depth: 30, height: 12 });
    const box = (await callTool(token, "studio_inspect_body", { design_id: id, feature_id: "box-1" })).data;
    expect(box.faces).toHaveLength(6);
    expect(box.edges).toHaveLength(12);
    const vertical = box.edges.filter((edge: { a: number[]; b: number[] }) => edge.a[2] !== edge.b[2]);
    const rounded = await callTool(token, "studio_fillet", {
      design_id: id,
      feature_id: "box-1",
      edges: vertical.map(({ a, b }: { a: number[]; b: number[] }) => ({ a, b })),
      radius: 4,
    });
    expect(rounded.data).toMatchObject({ created: ["fillet-2"], problems: [] });

    const drilled = await callTool(token, "studio_hole", {
      design_id: id,
      feature_id: "fillet-2",
      point: [0, 0, 12],
      normal: [0, 0, 1],
      diameter: 5,
      counterbore: { diameter: 10, depth: 4 },
    });
    expect(drilled.data).toMatchObject({ created: ["hole-3"], problems: [] });
    const read = await callTool(token, "studio_get_design", { design_id: id });
    const volume = read.data.bodies[0].volume_mm3 as number;
    const corners = 4 * (16 - 4 * Math.PI) * 12;
    const hole = Math.PI * 6.25 * 12 + Math.PI * (25 - 6.25) * 4;
    expect(Math.abs(volume - (40 * 30 * 12 - corners - hole)) / volume).toBeLessThan(0.01);

    // Too big a radius isn't refused outright: the reply says what's wrong, and undo takes it back.
    const tooBig = await callTool(token, "studio_update_feature", {
      design_id: id,
      feature_id: "fillet-2",
      radius: 20,
    });
    expect(tooBig.data.problems[0].message).toMatch(/too big/);
    await callTool(token, "studio_undo", { design_id: id });

    const split = await callTool(token, "studio_split", {
      design_id: id,
      feature_id: "hole-3",
      plane: { point: [0, 0, 6], normal: [0, 0, 1] },
    });
    expect(split.data).toMatchObject({ created: ["split-4", "split-5"], problems: [] });
  });

  describe("importing library models", () => {
    /** An ASCII STL of a w x d x h box from the origin, Z up; `open` leaves its top off. */
    function boxStl(w: number, d: number, h: number, open = false): string {
      return `solid box\n${boxFacets(w, d, h, open, [0, 0, 0])}\nendsolid box\n`;
    }

    /** A box's facets, from `at`. */
    function boxFacets(w: number, d: number, h: number, open: boolean, at: [number, number, number]): string {
      const v = (x: number, y: number, z: number) => `vertex ${at[0] + x * w} ${at[1] + y * d} ${at[2] + z * h}`;
      const quads: [number, number, number][][] = [
        [
          [0, 0, 0],
          [0, 1, 0],
          [1, 1, 0],
          [1, 0, 0],
        ],
        [
          [0, 0, 1],
          [1, 0, 1],
          [1, 1, 1],
          [0, 1, 1],
        ],
        [
          [0, 0, 0],
          [1, 0, 0],
          [1, 0, 1],
          [0, 0, 1],
        ],
        [
          [0, 1, 0],
          [0, 1, 1],
          [1, 1, 1],
          [1, 1, 0],
        ],
        [
          [0, 0, 0],
          [0, 0, 1],
          [0, 1, 1],
          [0, 1, 0],
        ],
        [
          [1, 0, 0],
          [1, 1, 0],
          [1, 1, 1],
          [1, 0, 1],
        ],
      ].filter((_, i) => !(open && i === 1)) as [number, number, number][][];
      return quads
        .flatMap(([a, b, c, e]) =>
          [
            [a, b, c],
            [a, c, e],
          ].map((tri) => `facet normal 0 0 0\nouter loop\n${tri.map((p) => v(...p)).join("\n")}\nendloop\nendfacet`),
        )
        .join("\n");
    }

    async function upload(session: string, filename: string, data: string | Buffer) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-studio-"));
      const file = path.join(dir, filename);
      fs.writeFileSync(file, data);
      const res = await request(app).post("/api/upload").set(auth(session)).attach("files", file);
      fs.rmSync(dir, { recursive: true, force: true });
      if (res.status !== 200) throw new Error(`upload: ${res.status} ${JSON.stringify(res.body)}`);
      return { modelId: res.body.prints[0].id as string, fileId: res.body.prints[0].plates[0].id as string };
    }

    it("reopens a Studio project with its named plates, objects, colors, and placements", async () => {
      const original = (await request(app).post("/api/studio/designs").set(auth(alice)).send({ name: "Round trip" }))
        .body;
      const lids = (await command(alice, original.id, "create_plate", { name: "Lids" })).body.created[0];
      const box = { width: 10, depth: 20, height: 6 };
      await command(alice, original.id, "add_box", {
        ...box,
        name: "Red base",
        color: "#ff0000",
        position: [30, -15, 0],
      });
      await command(alice, original.id, "add_box", {
        ...box,
        name: "Blue lid",
        color: "#0000ff",
        plate_id: lids,
        position: [-15, 5, 2],
      });
      const saved = await request(app)
        .post(`/api/studio/designs/${original.id}/save-to-library`)
        .set(auth(alice))
        .send({});
      expect(saved.status).toBe(201);
      const design = (await request(app).post("/api/studio/designs").set(auth(alice)).send({})).body;
      const opened = await command(alice, design.id, "import_model", { model_id: saved.body.model.id });
      expect(opened.status).toBe(200);
      expect(opened.body.created).toEqual(["mesh-1", "mesh-2"]);
      const { features, plates } = opened.body.design.document;
      expect(plates).toEqual([
        { name: "Plate 1", id: "plate-1" },
        { name: "Lids", id: "plate-2" },
      ]);
      expect(features).toMatchObject([
        { name: "Red base", type: "mesh", color: "#ff0000", plate_id: "plate-1", solid: true, size: [10, 20, 6] },
        { name: "Blue lid", type: "mesh", color: "#0000ff", plate_id: "plate-2", solid: true, size: [10, 20, 6] },
      ]);
      expect(features[0].transform.position).toEqual([30, -15, 0]);
      expect(features[1].transform.position[0]).toBeCloseTo(-15, 3);
      expect(features[1].transform.position.slice(1)).toEqual([5, 2]);
      const undone = await command(alice, design.id, "undo");
      expect(undone.body.design.document.features).toEqual([]);
      expect(undone.body.design.document.plates).toBeUndefined();
      const redone = await command(alice, design.id, "redo");
      expect(redone.body.design.document.features).toEqual(features);
    });

    it("opens a plain inch 3MF with repeated, mirrored build items at their relative spacing", async () => {
      const zip = new JSZip();
      const vertices = [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1],
      ]
        .map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`)
        .join("");
      const triangles = [
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
      ];
      const faces = [];
      for (let i = 0; i < triangles.length; i += 3) {
        faces.push(`<triangle v1="${triangles[i]}" v2="${triangles[i + 1]}" v3="${triangles[i + 2]}"/>`);
      }
      zip.file(
        "3D/3dmodel.model",
        `<model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
        <resources><object id="1" name="Inch &amp; cube" type="model"><mesh>
        <vertices>${vertices}</vertices><triangles>${faces.join("")}</triangles>
        </mesh></object></resources><build><item objectid="1"/>
        <item objectid="1" transform="-1 0 0 0 1 0 0 0 1 3 0 0"/>
        <item objectid="1" printable="0" transform="1 0 0 0 1 0 0 0 1 20 0 0"/>
        <item objectid="1" printable="false" transform="1 0 0 0 1 0 0 0 1 30 0 0"/>
        </build></model>`,
      );
      const file = await upload(alice, "inches.3mf", await zip.generateAsync({ type: "nodebuffer" }));
      const design = (await request(app).post("/api/studio/designs").set(auth(alice)).send({})).body;
      const res = await command(alice, design.id, "import_model", { model_id: file.modelId });
      expect(res.status).toBe(200);
      const { features } = res.body.design.document;
      expect(features).toHaveLength(2);
      for (const body of features)
        expect(body).toMatchObject({ name: "Inch & cube", size: [25.4, 25.4, 25.4], solid: true });
      expect(features[1].transform.position[0] - features[0].transform.position[0]).toBeCloseTo(50.8, 3);
    });

    it("brings a closed STL in as a solid, centred on the bed, that booleans can cut", async () => {
      const box = await upload(alice, "studio-box.stl", boxStl(10, 20, 30));
      const library = await request(app).get("/api/studio/library").set(auth(alice));
      const listed = library.body.models.find((model: { id: string }) => model.id === box.modelId);
      expect(listed.files).toEqual([expect.objectContaining({ id: box.fileId, name: "studio-box.stl" })]);

      const { body: design } = await request(app).post("/api/studio/designs").set(auth(alice)).send({});
      const imported = await command(alice, design.id, "import_model", { model_id: box.modelId });
      expect(imported.status).toBe(200);
      expect(imported.body.created).toEqual(["mesh-1"]);
      const mesh = imported.body.design.document.features[0];
      expect(mesh).toMatchObject({
        type: "mesh",
        solid: true,
        size: [10, 20, 30],
        source: { model_id: box.modelId, file_id: box.fileId, file_name: "studio-box.stl" },
      });

      const asset = await request(app)
        .get(`/api/studio/designs/${design.id}/assets/${mesh.asset_id}`)
        .set(auth(alice))
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => done(null, Buffer.concat(chunks)));
        });
      expect(asset.status).toBe(200);
      const zs = decodeMesh(new Uint8Array(asset.body as Buffer)).positions.filter((_, i) => i % 3 === 2);
      expect([Math.min(...zs), Math.max(...zs)]).toEqual([0, 30]);
      expect(
        (await request(app).get(`/api/studio/designs/${design.id}/assets/${mesh.asset_id}`).set(auth(bob))).status,
      ).toBe(404);

      await command(alice, design.id, "add_cylinder", { radius: 3, height: 50, position: [0, 0, -10] });
      const cut = await command(alice, design.id, "boolean", {
        operation: "subtract",
        target_id: "mesh-1",
        tool_ids: ["cylinder-2"],
      });
      expect(cut.status).toBe(200);
      // Someone else's model isn't one to import.
      expect((await command(bob, design.id, "import_model", { model_id: box.modelId })).status).toBe(404);

      const owner = (await prisma.studioDesign.findUniqueOrThrow({ where: { id: design.id } })).userId;
      expect(fs.existsSync(studioAssetDir(owner, design.id))).toBe(true);
      await request(app).delete(`/api/studio/designs/${design.id}`).set(auth(alice));
      expect(fs.existsSync(studioAssetDir(owner, design.id))).toBe(false);
    });

    it("lets an assistant import an open mesh, which shows and measures but won't combine", async () => {
      const open = await upload(alice, "studio-tray.stl", boxStl(40, 40, 10, true));
      const res = await request(app)
        .post("/api/profile/api-token")
        .set(auth(alice))
        .send({ mcp_tools: [...DEFAULT_MCP_TOOL_NAMES, ...STUDIO_TOOLS] });
      const token = res.body.token as string;
      const id = (await callTool(token, "studio_create_design", {})).data.design_id as string;
      const imported = await callTool(token, "studio_import_model", {
        design_id: id,
        model_id: open.modelId,
        position: [0, 0, 5],
      });
      expect(imported.data.done).toMatch(/not a closed solid/);
      await callTool(token, "studio_add_box", { design_id: id, width: 5, depth: 5, height: 5 });
      const refused = await callTool(token, "studio_boolean", {
        design_id: id,
        operation: "union",
        target_id: "mesh-1",
        tool_ids: ["box-2"],
      });
      expect(refused).toMatchObject({ isError: true, text: expect.stringMatching(/isn't a closed solid/) });
      const read = await callTool(token, "studio_get_design", { design_id: id });
      const body = read.data.bodies.find((each: { id: string }) => each.id === "mesh-1");
      expect(body).toMatchObject({ size: [40, 40, 10], volume_mm3: null });
      expect(body.bounds.min[2]).toBe(5);
      const view = await callTool(token, "studio_view_design", { design_id: id, size: 128 });
      expect(view.content.some((part) => part.type === "image")).toBe(true);
    });

    it("says a model came in as several parts, and separates them into bodies an assistant can work on", async () => {
      const pair = `solid pair\n${boxFacets(10, 10, 10, false, [0, 0, 0])}\n${boxFacets(10, 10, 20, false, [30, 0, 0])}\nendsolid pair\n`;
      const model = await upload(alice, "studio-pair.stl", pair);
      const res = await request(app)
        .post("/api/profile/api-token")
        .set(auth(alice))
        .send({ mcp_tools: [...DEFAULT_MCP_TOOL_NAMES, ...STUDIO_TOOLS] });
      const token = res.body.token as string;
      const id = (await callTool(token, "studio_create_design", {})).data.design_id as string;
      const imported = await callTool(token, "studio_import_model", { design_id: id, model_id: model.modelId });
      expect(imported.data.done).toMatch(/2 separate parts in one body: separate_parts/);

      const separated = await callTool(token, "studio_separate_parts", { design_id: id, feature_id: "mesh-1" });
      expect(separated.data).toMatchObject({ created: ["part-2", "part-3"], problems: [] });
      const read = await callTool(token, "studio_get_design", { design_id: id });
      expect(read.data.top_level).toEqual(["part-2", "part-3"]);
      // Largest first, each standing where it was, its own origin at its base's middle.
      const tall = read.data.features.find((each: { id: string }) => each.id === "part-2");
      expect(tall).toMatchObject({
        type: "part",
        source_id: "mesh-1",
        solid: true,
        transform: { position: [15, 0, 0] },
      });
      const sizes = read.data.bodies.map((each: { id: string; size: number[] }) => [each.id, each.size]);
      expect(sizes).toEqual([
        ["part-2", [10, 10, 20]],
        ["part-3", [10, 10, 10]],
      ]);
      // A part is a body like any other: it can be drilled, and it's one part.
      const hole = await callTool(token, "studio_hole", {
        design_id: id,
        feature_id: "part-3",
        point: [-15, 0, 10],
        normal: [0, 0, 1],
        diameter: 4,
      });
      expect(hole.data.problems).toEqual([]);
      const again = await callTool(token, "studio_separate_parts", { design_id: id, feature_id: "hole-4" });
      expect(again).toMatchObject({ isError: true, text: expect.stringMatching(/one part/) });

      // Deleting the parts gives the model back.
      await callTool(token, "studio_delete_feature", { design_id: id, feature_id: "part-2" });
      await callTool(token, "studio_delete_feature", { design_id: id, feature_id: "hole-4" });
      await callTool(token, "studio_delete_feature", { design_id: id, feature_id: "part-3" });
      expect((await callTool(token, "studio_get_design", { design_id: id })).data.top_level).toEqual(["mesh-1"]);
    });
  });
});
