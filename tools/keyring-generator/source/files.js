// The keyring as files.
//
// The 3MF keeps every piece as its own object inside one assembly, with the colours as a material list and a
// Bambu-style settings part naming the extruder for each — so a slicer opens it with the letters and the border
// already told apart and assigned, rather than as one lump to sort out by hand. No printer profile and no G-code
// go in: those belong to the person slicing it.
//

import { colourIssues, colourSlot, palette } from "./colours.js";

const utf8 = new TextEncoder();

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const deflate = async (bytes) => {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** A ZIP of the entries given, each squeezed where squeezing helps. */
async function zip(entries) {
  const chunks = [];
  const directory = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = utf8.encode(name);
    const raw = utf8.encode(text);
    const crc = crc32(raw);
    const packed = await deflate(raw);
    const squeezed = packed.length < raw.length;
    const data = squeezed ? packed : raw;

    const local = new Uint8Array(30);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, squeezed ? 8 : 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, raw.length, true);
    view.setUint16(26, nameBytes.length, true);
    chunks.push(local, nameBytes, data);

    const central = new Uint8Array(46);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, squeezed ? 8 : 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, raw.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    directory.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directorySize = directory.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);

  const all = [...chunks, ...directory, end];
  const out = new Uint8Array(all.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const xml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c],
  );

/** How far apart pieces are laid out when they're to be printed separately, in mm. */
const APART = 5;

/** Where each piece sits: in place as it was built, or spread along x so nothing overlaps. */
function placement(models, separate) {
  let cursor = 0;
  return models.map((model) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    for (let i = 0; i < model.vertices.length; i += 3) {
      minX = Math.min(minX, model.vertices[i]);
      maxX = Math.max(maxX, model.vertices[i]);
      minZ = Math.min(minZ, model.vertices[i + 2]);
    }
    const dx = separate ? cursor - minX : 0;
    const dz = separate ? -minZ : 0;
    cursor += maxX - minX + APART;
    return { dx, dz };
  });
}

/** The keyring as a 3MF: one assembly, a part per piece, each with its colour and its extruder. */
export async function threeMf(models, colours, { separate = false, title = "Keyring" } = {}) {
  const issues = colourIssues(models.map((m) => m.char || "").join(""), colours, models);
  if (issues.duplicates.length) throw new Error(`${issues.duplicates.join(", ")} is given two colours at once.`);

  // Only the filaments actually in use: an extra colour switched off shouldn't make a slicer ask for a fourth
  // spool. The slots keep their numbers, so what is listed is everything up to the highest one used.
  const highest = models.reduce((top, model) => Math.max(top, colourSlot(model, colours)), 0);
  const colourList = palette(colours).slice(0, highest + 1);
  const identity = "1 0 0 0 1 0 0 0 1 0 0 0";
  const where = placement(models, separate);
  const assembly = 100;

  const parts = models.map((model, i) => {
    const { dx, dz } = where[i];
    const slot = colourSlot(model, colours);
    const name = `${model.name}${model.char ? ` ${model.char}` : ""} [${slot + 1}]`;
    let vertices = "";
    let triangles = "";
    for (let j = 0; j < model.vertices.length; j += 3) {
      vertices += `<vertex x="${(model.vertices[j] + dx).toFixed(6)}" y="${model.vertices[j + 1].toFixed(6)}" z="${(model.vertices[j + 2] + dz).toFixed(6)}"/>`;
    }
    for (let j = 0; j < model.triangles.length; j += 3) {
      triangles += `<triangle v1="${model.triangles[j]}" v2="${model.triangles[j + 1]}" v3="${model.triangles[j + 2]}"/>`;
    }
    return {
      id: i + 1,
      slot,
      name,
      mesh:
        `<object id="${i + 1}" type="model" name="${xml(name)}" pid="${1000 + slot}" pindex="0">` +
        `<mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`,
    };
  });

  const groups = colourList
    .map((colour, i) => `<m:colorgroup id="${1000 + i}"><m:color color="${colour.toUpperCase()}FF"/></m:colorgroup>`)
    .join("");
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" ` +
    `xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">` +
    `<metadata name="Title">${xml(title)}</metadata>` +
    `<metadata name="Application">Thingport keyring generator</metadata>` +
    `<resources>${groups}${parts.map((p) => p.mesh).join("")}` +
    `<object id="${assembly}" type="model" name="${xml(title)}"><components>` +
    parts.map((p) => `<component objectid="${p.id}" transform="${identity}"/>`).join("") +
    `</components></object></resources>` +
    `<build><item objectid="${assembly}" transform="${identity}"/></build></model>`;

  const settings =
    `<?xml version="1.0" encoding="UTF-8"?><config><object id="${assembly}">` +
    `<metadata key="name" value="${xml(title)}"/><metadata key="extruder" value="1"/>` +
    parts
      .map(
        (p) =>
          `<part id="${p.id}" subtype="normal_part"><metadata key="name" value="${xml(p.name)}"/>` +
          `<metadata key="extruder" value="${p.slot + 1}"/></part>`,
      )
      .join("") +
    `</object></config>`;

  return zip([
    [
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
        `<Default Extension="config" ContentType="application/xml"/>` +
        `<Default Extension="json" ContentType="application/json"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
    ],
    ["3D/3dmodel.model", model],
    ["Metadata/model_settings.config", settings],
    [
      "Metadata/keyring-colours.json",
      JSON.stringify({
        slots: colourList.map((colour, i) => ({ slot: i + 1, colour })),
        parts: parts.map((p) => ({ name: p.name, slot: p.slot + 1 })),
      }),
    ],
  ]);
}

/** The keyring as an OBJ, one named object per piece. */
export function obj(models, { separate = false, title = "Keyring" } = {}) {
  const where = placement(models, separate);
  let offset = 1;
  let out = `# ${title}\n# Thingport keyring generator. Millimetres, Z up.\n`;
  models.forEach((model, i) => {
    const { dx, dz } = where[i];
    out += `o ${model.name}\n`;
    for (let j = 0; j < model.vertices.length; j += 3) {
      out += `v ${(model.vertices[j] + dx).toFixed(5)} ${model.vertices[j + 1].toFixed(5)} ${(model.vertices[j + 2] + dz).toFixed(5)}\n`;
    }
    for (let j = 0; j < model.triangles.length; j += 3) {
      out += `f ${model.triangles[j] + offset} ${model.triangles[j + 1] + offset} ${model.triangles[j + 2] + offset}\n`;
    }
    offset += model.vertices.length / 3;
  });
  return out;
}

/** Every piece in one binary STL, for anything that reads nothing else. STL carries no colours. */
export function stl(models, { separate = false, title = "Keyring" } = {}) {
  const where = placement(models, separate);
  const count = models.reduce((total, model) => total + model.triangles.length / 3, 0);
  const bytes = new Uint8Array(84 + count * 50);
  const view = new DataView(bytes.buffer);
  utf8.encodeInto(`${title} - Thingport keyring generator`.slice(0, 79), bytes.subarray(0, 80));
  view.setUint32(80, count, true);
  let at = 84;
  models.forEach((model, i) => {
    const { dx, dz } = where[i];
    const point = (index) => [
      model.vertices[index * 3] + dx,
      model.vertices[index * 3 + 1],
      model.vertices[index * 3 + 2] + dz,
    ];
    for (let j = 0; j < model.triangles.length; j += 3) {
      const a = point(model.triangles[j]);
      const b = point(model.triangles[j + 1]);
      const c = point(model.triangles[j + 2]);
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      for (const value of [nx, ny, nz, ...a, ...b, ...c]) {
        view.setFloat32(at, value, true);
        at += 4;
      }
      at += 2;
    }
  });
  return bytes;
}
