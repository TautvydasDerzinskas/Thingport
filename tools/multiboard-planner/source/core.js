// Board planner core: a line-by-line port of the original calculator
// (PlacementCalculatorTileSetupSimple/Advanced, DesignerResultProcessor, the mount
// processors and PartDataLinks). Behaviour, including quirks, is kept on purpose so
// results match the original; deliberate deviations are marked "DEVIATION".
(function (root) {
  'use strict';

  const TILE_CELL_OFFSET = 25;
  const MM_TO_INCH = 25.4;
  const AVAILABLE_TILE_SIZE = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const TILE_GENERATOR_LINK = 'https://thangs.com/designer/Multiboard/3d-model/Multiboard%20Tile%20Generator-975159';
  const TILE_GENERATOR_LINK_BORDERED = 'https://www.multiboard.io/generator/tile';
  const MM = 0, INCH = 1;

  // Godot's FileAccess.get_csv_line(): comma separated, "" escapes inside quotes.
  function parseCsv(text) {
    const rows = [];
    for (const raw of text.replace(/\r/g, '').split('\n')) {
      const row = [];
      let cur = '', quoted = false;
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (quoted) {
          if (c === '"' && raw[i + 1] === '"') { cur += '"'; i++; }
          else if (c === '"') quoted = false;
          else cur += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(cur); cur = ''; }
        else cur += c;
      }
      row.push(cur);
      rows.push(row);
    }
    return rows;
  }

  class PartDataLinks {
    constructor(partLinksCsv, snapsCsv, tileNamesCsv) {
      this.dataCore = new Map();
      this.dataSide = new Map();
      this.dataCorner = new Map();
      this.borderedTiles = new Map();
      this.snaps = new Map();
      this.tileNames = new Map();
      parseCsv(partLinksCsv).forEach((line, index) => {
        if (line.length < 2 || index === 0) return;
        const [key, type, link] = line;
        if (type === 'C') this.dataCore.set(key, link);
        else if (type === 'S') this.dataSide.set(key, link);
        else if (type === 'CR') this.dataCorner.set(key, link);
        else this.borderedTiles.set(key + '_' + type, link);
      });
      for (const line of parseCsv(snapsCsv)) {
        const entry = [line[3], line[2], line[1], [line[4]], line[6], line[5]];
        if (!this.snaps.has(line[0])) this.snaps.set(line[0], []);
        this.snaps.get(line[0]).push(entry);
      }
      parseCsv(tileNamesCsv).forEach((line, index) => {
        if (index === 0 || line.length < 2) return;
        if (!this.tileNames.has(line[0])) this.tileNames.set(line[0], line[1]);
      });
    }
    getBorderedTile(size, type) { return this.borderedTiles.get(size + '_' + type) ?? TILE_GENERATOR_LINK_BORDERED; }
    getCoreTile(size) { return this.dataCore.get(size) ?? TILE_GENERATOR_LINK; }
    getSnapData(name, type, side, alignment = '') {
      for (const snap of this.snaps.get(name) ?? []) {
        if (snap[0] === side && snap[1] === type && snap[5] === alignment) return snap;
      }
      return [];
    }
    getSnapMinTileSize(name) {
      const list = this.snaps.get(name);
      return list && list.length ? parseInt(list[0][4], 10) || 0 : 0;
    }
    mountTypes() { return [...this.snaps.keys()].filter((k) => k !== 'Dual Clips'); }
  }

  class DesignerData {
    constructor(width, height, tileSize, units, mountingType) {
      this.width = width;
      this.height = height;
      this.tileSize = Math.trunc(tileSize);
      this.units = units;
      this.mountingType = mountingType;
      this.tiles = null;
      this.remaining = [0, 0];
    }
    widthMm() { return this.units === MM ? this.width : this.width * MM_TO_INCH; }
    heightMm() { return this.units === MM ? this.height : this.height * MM_TO_INCH; }
    remainingInUnits() {
      return this.units === MM ? [...this.remaining] : this.remaining.map((v) => v / MM_TO_INCH);
    }
    unitsLabel() { return this.units === MM ? 'mm' : 'inch'; }
    isValid() { return this.width > 0 && this.height > 0 && this.tileSize > 0; }
  }

  // TilePlacementData: insertion-ordered, keyed by grid position, int-typed fields.
  class TilePlacement {
    constructor() { this.map = new Map(); }
    add(x, y, sizeX, sizeY, type, rotation = 0) {
      x = Math.trunc(x); y = Math.trunc(y); sizeX = Math.trunc(sizeX); sizeY = Math.trunc(sizeY);
      if (x < 0 || y < 0 || sizeX <= 0 || sizeY <= 0 || type === '') return;
      this.map.set(x + ',' + y, { x, y, sizeX, sizeY, type, rotation });
    }
    get(x, y) { return this.map.get(x + ',' + y); }
    values() { return [...this.map.values()]; }
  }

  function selectMaxSize(unit, remainingSpace) {
    let selected = -1;
    for (const size of AVAILABLE_TILE_SIZE) if (size * unit <= remainingSpace) selected = size;
    return selected;
  }

  // Shared start of both calculators.
  function setup(data) {
    const unit = TILE_CELL_OFFSET;
    const tilePx = data.tileSize * unit;
    const w = Math.trunc(data.widthMm() / tilePx);
    const h = Math.trunc(data.heightMm() / tilePx);
    return {
      unit, tilePx, w, h,
      remX: selectMaxSize(unit, data.widthMm() - w * tilePx),
      remY: selectMaxSize(unit, data.heightMm() - h * tilePx),
    };
  }

  // "Single Tiles (Simple)": every tile is a fully bordered single tile joined by dual clips.
  function placeSimple(data) {
    const tiles = new TilePlacement();
    const { unit, tilePx, w, h, remX, remY } = setup(data);
    let remainingWidth = data.widthMm();
    let remainingHeight = data.heightMm();
    let dualClips = 0;
    const half = (n) => Math.floor(n / 2);
    let mode = 0;
    if (w > 0 && h > 0) {
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
          mode = 3;
          tiles.add(x, y, data.tileSize, data.tileSize, 'SpecialRounded', 0);
          if (w > 1 && h > 1) {
            if (x === w - 1 && y === h - 1) continue;
            else if (x === w - 1 && y < h - 1) dualClips += half(data.tileSize);
            else if (y === h - 1 && x < w - 1) dualClips += half(data.tileSize);
            else dualClips += 2 * half(data.tileSize);
          }
        }
      }
      remainingWidth -= w * tilePx;
      remainingHeight -= h * tilePx;
    } else {
      data.remaining = [remainingWidth, remainingHeight];
      return { tiles, dualClips };
    }
    data.remaining = [remainingWidth, remainingHeight];
    if (mode !== 0 && (remX > 0 || remY > 0)) {
      const fillX = remX * unit, fillY = remY * unit;
      if (remX > 0 && remY > 0) {
        tiles.add(w, h, remX, remY, 'SpecialRounded', 0);
        data.remaining[0] -= fillX; data.remaining[1] -= fillY;
        dualClips += half(remX) + half(remY);
      }
      // The original subtracts the fill again below even when the corner tile already
      // did, so with both remainders the unused space goes negative and is hidden.
      // The tile list and counts are unaffected; the UI recomputes unused space.
      if (remX > 0) {
        data.remaining[0] -= fillX;
        for (let y = 0; y < h; y++) {
          dualClips += half(data.tileSize);
          tiles.add(w, y, remX, data.tileSize, 'SpecialRounded', 0);
        }
      }
      if (remY > 0) {
        data.remaining[1] -= fillY;
        for (let x = 0; x < w; x++) {
          dualClips += half(data.tileSize);
          tiles.add(x, h, data.tileSize, remY, 'SpecialRounded', 0);
        }
      }
    }
    return { tiles, dualClips };
  }

  // "Grid Tiles (Advanced)": core, edge and corner tiles, or strips for a single row/column.
  function placeAdvanced(data) {
    const tiles = new TilePlacement();
    const { unit, tilePx, w, h, remX, remY } = setup(data);
    let remainingWidth = data.widthMm();
    let remainingHeight = data.heightMm();
    let mode = 0;
    if (w > 0 && h > 0) {
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
          let type = '';
          let rotation = 0;
          if (w === 1 && h === 1) {
            if ((remX > 0) !== (remY > 0)) {
              mode = 1;
              if (remX > 0) type = 'Beginning Horizontal';
              else if (remY > 0) { rotation = -90; type = 'Beginning Vertical'; }
            } else if (remX > 0 && remY > 0) {
              type = 'CR3';
              mode = 2;
            } else {
              type = 'SpecialRounded';
            }
          } else if (w === 1 && h > 1 && remX <= 0) {
            mode = 1;
            rotation = -90;
            if (y === 0) type = 'Beginning Vertical';
            else if (y === h - 1 && remY <= 0) type = 'End Vertical';
            else type = 'Middle Vertical';
          } else if (h === 1 && w > 1 && remY <= 0) {
            mode = 1;
            if (x === 0) type = 'Beginning Horizontal';
            else if (x === w - 1 && remX <= 0) type = 'End Horizontal';
            else type = 'Middle Horizontal';
          } else if (w === 2 && remX <= 0 && remY <= 0) {
            if (x === 0) type = y === 0 ? 'CR3' : y === h - 1 ? 'CR1' : 'S2';
            else type = y === 0 ? 'CR4' : y === h - 1 ? 'CR2' : 'S3';
          } else if (h === 2 && remX <= 0 && remY <= 0) {
            if (y === 0) type = x === 0 ? 'CR3' : x === w - 1 ? 'CR4' : 'S4';
            else type = x === 0 ? 'CR1' : x === w - 1 ? 'CR2' : 'S1';
          } else {
            mode = 2;
            const lastX = x === w - 1 && remX <= 0;
            if (y === 0) type = x === 0 ? 'CR3' : lastX ? 'CR4' : 'S4';
            else if (y === h - 1 && remY <= 0) type = x === 0 ? 'CR1' : lastX ? 'CR2' : 'S1';
            else type = x === 0 ? 'S2' : lastX ? 'S3' : 'C1';
          }
          tiles.add(x, y, data.tileSize, data.tileSize, type, rotation);
        }
      }
      remainingWidth -= w * tilePx;
      remainingHeight -= h * tilePx;
    } else {
      data.remaining = [remainingWidth, remainingHeight];
      return { tiles };
    }
    data.remaining = [remainingWidth, remainingHeight];
    if (mode !== 0 && (remX > 0 || remY > 0)) {
      const fillX = remX * unit, fillY = remY * unit;
      if (mode === 1) {
        if (remX > 0) {
          tiles.add(w, 0, remX, data.tileSize, 'End Horizontal', 0);
          data.remaining[0] -= fillX;
        } else if (remY > 0) {
          tiles.add(0, h, data.tileSize, remY, 'End Vertical', -90);
          data.remaining[1] -= fillY;
        }
      }
      if (mode === 2) {
        let cr2Placed = false;
        if (remX > 0 && remY > 0) {
          tiles.add(w, h, remX, remY, 'CR2', 0);
          cr2Placed = true;
          data.remaining[0] -= fillX; data.remaining[1] -= fillY;
        }
        if (remX > 0) {
          const rows = remY > 0 ? h + 1 : h;
          for (let y = 0; y < rows - 1; y++) tiles.add(w, y, remX, data.tileSize, y === 0 ? 'CR4' : 'S3', 0);
          if (!cr2Placed) {
            cr2Placed = true;
            tiles.add(w, rows - 1, remX, data.tileSize, 'CR2', 0);
            data.remaining[0] -= fillX;
          }
        }
        if (remY > 0) {
          const cols = remX > 0 ? w + 1 : w;
          for (let x = 0; x < cols - 1; x++) tiles.add(x, h, data.tileSize, remY, x === 0 ? 'CR1' : 'S1', 0);
          if (!cr2Placed) {
            cr2Placed = true;
            tiles.add(cols - 1, h, data.tileSize, remY, 'CR2', 0);
            data.remaining[1] -= fillY;
          }
        }
      }
    }
    return { tiles };
  }

  // DesignerResultProcessor.get_tiles_as_array: [printRows, saveRows].
  function tilesAsArray(data, parts) {
    const counts = new Map(), links = new Map(), types = new Map();
    for (const t of data.tiles.values()) {
      const sizeText = t.sizeX + 'x' + t.sizeY;
      let name = sizeText + ' ';
      let link = '';
      if (parts.tileNames.has(t.type)) {
        name += parts.tileNames.get(t.type);
        link = ['CR', 'C', 'S'].includes(t.type) ? parts.getCoreTile(sizeText) : parts.getBorderedTile(sizeText, t.type);
      }
      name += ' Tile';
      if (counts.has(name)) counts.set(name, counts.get(name) + 1);
      else { counts.set(name, 1); links.set(name, link); types.set(name, t.type); }
    }
    let sorted = new Map();
    for (const word of ['Corner', 'Edge', 'Core']) {
      for (const [key, n] of counts) if (key.includes(word)) sorted.set(key, n);
    }
    if (sorted.size === 0) sorted = counts;
    const print = [], save = [];
    for (const [key, n] of sorted) {
      print.push([key, n, links.get(key), types.get(key)]);
      save.push([key, n, links.get(key)]);
    }
    return [print, save];
  }

  // ArrayHelperMethods.get_last_column_index / get_top_row_index (start at 0).
  // A loop rather than Math.max(...spread), which overflows the stack on huge walls.
  function gridBounds(tiles) {
    let maxX = 0, maxY = 0;
    for (const t of tiles) {
      if (t.x > maxX) maxX = t.x;
      if (t.y > maxY) maxY = t.y;
    }
    return { maxX, maxY };
  }

  // Tiles a wall would need, before placing them, so the UI can refuse absurd sizes.
  function estimateTileCount(input) {
    const k = input.units === MM ? 1 : MM_TO_INCH;
    const cell = Math.trunc(input.tileSize) * TILE_CELL_OFFSET;
    if (!(cell > 0)) return 0;
    return Math.ceil((input.width * k) / cell) * Math.ceil((input.height * k) / cell);
  }

  function wallOffsetSnaps(data) {
    const mounts = { '2x2': 0, '2x1': 0, '1x2': 0, '1x1': 0 };
    const all = data.tiles.values();
    if (all.length === 0) return mounts;
    const { maxX, maxY } = gridBounds(all);
    const height = maxY + 1;
    const width = maxX + 1;
    if (width === 1 && height === 1) { mounts['1x1'] = 4; return mounts; }
    if (width === 1 || height === 1) {
      if (width === 1) mounts['1x2'] = 2 * (height - 1);
      else mounts['2x1'] = 2 * (width - 1);
      mounts['1x1'] = 4;
      return mounts;
    }
    mounts['2x2'] = (width - 1) * (height - 1);
    mounts['2x1'] = 2 * (width - 1);
    mounts['1x2'] = 2 * (height - 1);
    mounts['1x1'] = 4;
    return mounts;
  }

  const NAMING = { '1x1': 'Single', '2x1': 'Dual', '1x2': 'Dual', '2x2': 'Quad' };

  // DefaultMountProcessor.add_data: merges by name; print keeps line breaks, save drops them.
  function addData(out, partName, quantity, links) {
    const printName = partName.split('\\n').join('\n').split('\\').join('');
    const saveName = partName.split('\\n').join('').split('\\').join('');
    const merge = (list, name) => {
      const row = list.find((r) => r[0] === name);
      if (row) row[1] = String((parseInt(row[1], 10) || 0) + (parseInt(quantity, 10) || 0));
      else list.push([name, String(quantity), links]);
    };
    merge(out[0], printName);
    merge(out[1], saveName);
  }

  function combineDoubleMounts(mounts) {
    if ('1x2' in mounts) { mounts['2x1'] = mounts['1x2'] + mounts['2x1']; delete mounts['1x2']; }
  }

  const processors = {
    // SimpleFlushMountProcessor: every snap point becomes a screw / pillar.
    simpleFlush(data, mounts, parts, out) {
      combineDoubleMounts(mounts);
      if ('2x1' in mounts) { mounts['1x1'] += mounts['2x1'] * 2; delete mounts['2x1']; }
      if ('2x2' in mounts) { mounts['1x1'] += mounts['2x2'] * 4; delete mounts['2x2']; }
      for (const size in mounts) {
        if (mounts[size] <= 0) continue;
        const d = parts.getSnapData(data.mountingType, 'None', 'None');
        if (d.length) addData(out, d[2], mounts[size], d[3]);
      }
    },
    // OffsetSnapMountProcessor: single/dual/quad part A, plus one part B per snap point.
    offsetSnap(data, mounts, parts, out) {
      combineDoubleMounts(mounts);
      let partB = 0;
      for (const size in mounts) {
        const value = mounts[size];
        if (value <= 0) continue;
        partB += size === '1x1' ? value : size === '2x1' ? 2 * value : 4 * value;
        const d = parts.getSnapData(data.mountingType, NAMING[size], 'A');
        if (d.length) addData(out, d[2], value, d[3]);
      }
      if (partB > 0) {
        const d = parts.getSnapData(data.mountingType, 'None', 'None');
        addData(out, d[2], partB, d[3]);
      }
    },
    // FreeStandingMountPorcessor: part A + part B per mount, plus optional feet.
    freeStanding(data, mounts, parts, out) {
      combineDoubleMounts(mounts);
      for (const size in mounts) {
        const value = mounts[size];
        if (value <= 0) continue;
        for (const side of ['A', 'B']) {
          const d = parts.getSnapData(data.mountingType, NAMING[size], side);
          if (d.length) addData(out, d[2], value, d[3]);
        }
      }
      const stand = parts.getSnapData(data.mountingType, 'None', 'None');
      if (stand.length) addData(out, stand[2], '-', stand[3]);
    },
  };

  // DesignerResultProcessor.get_mounts_as_array for the mount types the original offers.
  function mountsAsArray(data, parts) {
    const mounts = wallOffsetSnaps(data);
    const out = [[], []];
    const type = data.mountingType;
    if (type === 'Simple Flush' || type === 'Offset Pillar') processors.simpleFlush(data, mounts, parts, out);
    else if (type === 'Offset Snap') processors.offsetSnap(data, mounts, parts, out);
    else if (type === 'Free Standing') processors.freeStanding(data, mounts, parts, out);
    return out;
  }

  // MultiboardDesigner.process_click without the UI.
  function calculate(input, parts) {
    const data = new DesignerData(input.width, input.height, input.tileSize, input.units, input.mountingType);
    if (!data.isValid()) return { error: 'dimensions' };
    const minSize = parts.getSnapMinTileSize(data.mountingType);
    if (data.tileSize < minSize) return { error: 'minSize', minSize };
    const placed = input.setup === 1 ? placeAdvanced(data) : placeSimple(data);
    data.tiles = placed.tiles;
    const tileRows = tilesAsArray(data, parts);
    // DEVIATION: the original indexes tileRows[0][0] here and stops with a script error
    // when no tile fits, leaving the previous result on screen. Report it instead.
    if (tileRows[0].length === 0) return { error: 'noTiles', data };
    if (tileRows[0][0][0].includes('Vertical')) {
      for (const member of tileRows) {
        const last = member.length - 1;
        [member[0], member[last]] = [member[last], member[0]];
      }
    }
    const mountRows = mountsAsArray(data, parts);
    if ('dualClips' in placed) {
      const d = parts.getSnapData('Dual Clips', 'None', 'None');
      mountRows.push([['Dual Clip', String(placed.dualClips), d[3]]]);
    }
    return { data, tileRows, mountRows, dualClips: placed.dualClips };
  }

  // Unused wall space after the tiles, in the input units.
  // DEVIATION: the original shows data.remaining, which in Simple mode goes negative
  // (and is then hidden) whenever both a remainder column and row are placed.
  function unusedSpace(data) {
    const all = data.tiles ? data.tiles.values() : [];
    const def = data.tileSize * TILE_CELL_OFFSET;
    let usedW = 0, usedH = 0;
    for (const t of all) {
      usedW = Math.max(usedW, t.x * def + t.sizeX * TILE_CELL_OFFSET);
      usedH = Math.max(usedH, t.y * def + t.sizeY * TILE_CELL_OFFSET);
    }
    const mm = [data.widthMm() - usedW, data.heightMm() - usedH];
    return data.units === MM ? mm : mm.map((v) => v / MM_TO_INCH);
  }

  // LineEditNumberLimit._on_text_changed: digits and one decimal separator.
  function sanitizeNumber(text) {
    let out = '';
    let hasDecimal = false;
    for (const c of text) {
      if (c === '.' || c === ',') {
        if (hasDecimal) continue;
        hasDecimal = true;
        if (out.length === 0) out += '0';
        out += '.';
      } else if (c >= '0' && c <= '9') {
        if (out.length === 1 && text[0] === '0') { out = c; continue; }
        if (c === '0' && out.length > 0 && !out.includes('.') && out[0] === '0') continue;
        out += c;
      }
    }
    return out;
  }

  root.PlannerCore = {
    TILE_CELL_OFFSET, MM_TO_INCH, MM, INCH, AVAILABLE_TILE_SIZE,
    parseCsv, PartDataLinks, DesignerData, TilePlacement,
    selectMaxSize, gridBounds, estimateTileCount, placeSimple, placeAdvanced, tilesAsArray, wallOffsetSnaps, mountsAsArray,
    calculate, unusedSpace, sanitizeNumber,
  };
})(typeof window !== 'undefined' ? window : globalThis);
