// Keyboard and pointer rules for TileMenu and NestedMenu, kept apart from the DOM so they can be tested.

/** Where a focusable thing in a TileMenu sits: the row of tiles, or the column under it (rows and their picks). */
export type TileZone = "tile" | "row";

/**
 * Where focus goes in a TileMenu on an arrow, Home or End key: an index into `zones`, or null to leave it.
 * The tiles are a row, left and right, that wraps; below them is one column, up and down. Leaving the column at
 * either end goes back to the tile it was entered from (`lastTile`), else the first. `current` is -1 when nothing
 * in the menu has focus.
 */
export function tileMenuMove(zones: TileZone[], current: number, key: string, lastTile: number | null): number | null {
  if (zones.length === 0) return null;
  if (current < 0) return key.startsWith("Arrow") || key === "Home" ? 0 : key === "End" ? zones.length - 1 : null;
  if (key === "Home") return 0;
  if (key === "End") return zones.length - 1;
  const tiles = zones.flatMap((zone, index) => (zone === "tile" ? [index] : []));
  const column = zones.flatMap((zone, index) => (zone === "row" ? [index] : []));
  const backUp = () => (lastTile !== null && tiles.includes(lastTile) ? lastTile : (tiles[0] ?? column[0]));
  if (zones[current] === "tile") {
    const at = tiles.indexOf(current);
    if (key === "ArrowRight") return tiles[(at + 1) % tiles.length];
    if (key === "ArrowLeft") return tiles[(at - 1 + tiles.length) % tiles.length];
    if (key === "ArrowDown") return column[0] ?? current;
    if (key === "ArrowUp") return column[column.length - 1] ?? current;
    return null;
  }
  const at = column.indexOf(current);
  if (key === "ArrowDown") return at < column.length - 1 ? column[at + 1] : backUp();
  if (key === "ArrowUp") return at > 0 ? column[at - 1] : backUp();
  return null;
}

export type Point = { x: number; y: number };
export type Box = { left: number; top: number; right: number; bottom: number };

export function insidePolygon(point: Point, polygon: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * Leaving a row whose submenu is open: the area that still counts as on the way to it. A triangle from just behind the
 * pointer to the submenu's near corners, and the submenu itself, so crossing the rows between doesn't switch it.
 */
export function safeArea(pointer: Point, submenu: Box): Point[] {
  const toLeft = (submenu.left + submenu.right) / 2 < pointer.x;
  const near = toLeft ? submenu.right : submenu.left;
  const far = toLeft ? submenu.left : submenu.right;
  return [
    { x: pointer.x + (toLeft ? 4 : -4), y: pointer.y },
    { x: near, y: submenu.top },
    { x: far, y: submenu.top },
    { x: far, y: submenu.bottom },
    { x: near, y: submenu.bottom },
  ];
}

/**
 * Where a submenu goes beside its row: to the right unless it would leave the window, then to the left if that's
 * roomier; and up by as much as it would hang below the bottom, never above the top. `room` is the width there is on
 * that side, which a submenu wider than both sides is narrowed to. `row` and `parent` are the row's and its menu's
 * boxes, `size` the submenu's, all in window coordinates.
 */
export function placeSubmenu(
  row: Box,
  parent: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  { gap = 4, margin = 8, lift = 7 }: { gap?: number; margin?: number; lift?: number } = {},
): { side: "right" | "left"; top: number; room: number } {
  const roomRight = viewport.width - margin - (parent.right + gap);
  const roomLeft = parent.left - gap - margin;
  const side = size.width <= roomRight || roomRight >= roomLeft ? "right" : "left";
  const wanted = row.top - lift;
  const top = Math.max(margin, Math.min(wanted, viewport.height - margin - size.height));
  return { side, top: top - parent.top, room: Math.max(0, Math.floor(side === "right" ? roomRight : roomLeft)) };
}
