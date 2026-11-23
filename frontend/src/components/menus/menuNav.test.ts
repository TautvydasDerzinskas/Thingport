import { describe, expect, it } from "vitest";
import { insidePolygon, placeSubmenu, safeArea, tileMenuMove, type TileZone } from "./menuNav";

// Three tiles, then a column of three rows.
const zones: TileZone[] = ["tile", "tile", "tile", "row", "row", "row"];

describe("tileMenuMove", () => {
  it("moves along the tiles and wraps at both ends", () => {
    expect(tileMenuMove(zones, 0, "ArrowRight", null)).toBe(1);
    expect(tileMenuMove(zones, 2, "ArrowRight", null)).toBe(0);
    expect(tileMenuMove(zones, 0, "ArrowLeft", null)).toBe(2);
  });

  it("goes down from a tile to the first row, and up to the last", () => {
    expect(tileMenuMove(zones, 1, "ArrowDown", null)).toBe(3);
    expect(tileMenuMove(zones, 1, "ArrowUp", null)).toBe(5);
  });

  it("walks the column and leaves it for the tile it came from", () => {
    expect(tileMenuMove(zones, 3, "ArrowDown", 1)).toBe(4);
    expect(tileMenuMove(zones, 5, "ArrowDown", 1)).toBe(1);
    expect(tileMenuMove(zones, 3, "ArrowUp", 2)).toBe(2);
    expect(tileMenuMove(zones, 3, "ArrowUp", null)).toBe(0);
  });

  it("leaves left and right in the column to the menu", () => {
    expect(tileMenuMove(zones, 4, "ArrowRight", null)).toBeNull();
    expect(tileMenuMove(zones, 4, "ArrowLeft", null)).toBeNull();
  });

  it("goes to either end on Home and End", () => {
    expect(tileMenuMove(zones, 4, "Home", null)).toBe(0);
    expect(tileMenuMove(zones, 1, "End", null)).toBe(5);
  });

  it("starts at the top when nothing has focus", () => {
    expect(tileMenuMove(zones, -1, "ArrowDown", null)).toBe(0);
    expect(tileMenuMove(zones, -1, "End", null)).toBe(5);
    expect(tileMenuMove(zones, -1, "a", null)).toBeNull();
  });

  it("stays on a tile with nothing under it", () => {
    expect(tileMenuMove(["tile", "tile"], 1, "ArrowDown", null)).toBe(1);
  });

  it("moves in a menu that is only rows", () => {
    expect(tileMenuMove(["row", "row"], 1, "ArrowDown", null)).toBe(0);
  });
});

describe("safeArea", () => {
  const submenu = { left: 200, top: 100, right: 400, bottom: 300 };

  it("covers the way from the row to a submenu on its right", () => {
    const area = safeArea({ x: 190, y: 120 }, submenu);
    expect(insidePolygon({ x: 195, y: 160 }, area)).toBe(true);
    expect(insidePolygon({ x: 195, y: 40 }, area)).toBe(false);
  });

  it("covers the way to a submenu on the left", () => {
    const area = safeArea({ x: 410, y: 120 }, submenu);
    expect(insidePolygon({ x: 405, y: 200 }, area)).toBe(true);
    expect(insidePolygon({ x: 430, y: 200 }, area)).toBe(false);
  });
});

describe("placeSubmenu", () => {
  const viewport = { width: 1000, height: 800 };
  const parent = { left: 300, top: 100, right: 520, bottom: 400 };
  const row = { left: 300, top: 160, right: 520, bottom: 194 };

  it("opens to the right, its first row level with the one it came from", () => {
    expect(placeSubmenu(row, parent, { width: 240, height: 200 }, viewport)).toEqual({
      side: "right",
      top: 53,
      room: 1000 - 8 - 524,
    });
  });

  it("opens to the left when the right has no room for it", () => {
    const nearEdge = { ...parent, left: 700, right: 920 };
    expect(placeSubmenu(row, nearEdge, { width: 240, height: 200 }, viewport).side).toBe("left");
  });

  it("stays right when neither side fits and the right is roomier", () => {
    const narrow = { width: 700, height: 800 };
    expect(placeSubmenu(row, { ...parent, left: 200, right: 420 }, { width: 400, height: 200 }, narrow).side).toBe(
      "right",
    );
  });

  it("gives the room on the side it picks, to narrow a submenu wider than both", () => {
    // 640 wide, the menu in the middle: 198 px either side.
    const phoneish = { width: 640, height: 800 };
    const middle = { ...parent, left: 210, right: 430 };
    expect(placeSubmenu(row, middle, { width: 360, height: 200 }, phoneish)).toMatchObject({
      side: "right",
      room: 198,
    });
    const leftRoomier = { ...parent, left: 230, right: 450 };
    expect(placeSubmenu(row, leftRoomier, { width: 360, height: 200 }, phoneish)).toMatchObject({
      side: "left",
      room: 218,
    });
  });

  it("keeps its side once narrowed to the room there", () => {
    const phoneish = { width: 640, height: 800 };
    const leftRoomier = { ...parent, left: 230, right: 450 };
    expect(placeSubmenu(row, leftRoomier, { width: 218, height: 200 }, phoneish).side).toBe("left");
  });

  it("moves up rather than hang below the window", () => {
    const low = { ...row, top: 700, bottom: 734 };
    expect(placeSubmenu(low, parent, { width: 240, height: 200 }, viewport).top).toBe(800 - 8 - 200 - 100);
  });

  it("never goes above the window", () => {
    expect(placeSubmenu(row, parent, { width: 240, height: 900 }, viewport).top).toBe(8 - 100);
  });
});
