// The model as files.
//
// The 3MF is the one to use: every part is its own object inside one assembly, with the filament colours as a
// material list and a Bambu-style settings part naming the extruder for each, so a slicer opens it with the code,
// the plate and the border already told apart and assigned. No printer profile and no G-code go in — those belong
// to whoever is slicing it.
//
// The STL carries no colour at all, so what goes in it is the raised shape of the code: a flush design would come
// out of a single-colour slicer as a blank tile.

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
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character],
  );

/** The model as a 3MF: one assembly, a part per filament, each with its colour and its extruder. */
export async function threeMf(model, { title = "QR code", application = "Thingport QR code generator" } = {}) {
  const identity = "1 0 0 0 1 0 0 0 1 0 0 0";
  const assembly = 100;

  const parts = model.parts.map((part, index) => {
    let vertices = "";
    let triangles = "";
    for (let i = 0; i < part.vertices.length; i += 3) {
      vertices += `<vertex x="${part.vertices[i].toFixed(4)}" y="${part.vertices[i + 1].toFixed(4)}" z="${part.vertices[i + 2].toFixed(4)}"/>`;
    }
    for (let i = 0; i < part.triangles.length; i += 3) {
      triangles += `<triangle v1="${part.triangles[i]}" v2="${part.triangles[i + 1]}" v3="${part.triangles[i + 2]}"/>`;
    }
    const name = `${part.name} [${part.slot + 1}]`;
    return {
      id: index + 1,
      slot: part.slot,
      name,
      mesh:
        `<object id="${index + 1}" type="model" name="${xml(name)}" pid="${1000 + part.slot}" pindex="0">` +
        `<mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`,
    };
  });

  const groups = model.filaments
    .map(
      (colour, index) =>
        `<m:colorgroup id="${1000 + index}"><m:color color="${colour.toUpperCase()}FF"/></m:colorgroup>`,
    )
    .join("");

  const document =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" ` +
    `xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">` +
    `<metadata name="Title">${xml(title)}</metadata>` +
    `<metadata name="Application">${xml(application)}</metadata>` +
    `<resources>${groups}${parts.map((part) => part.mesh).join("")}` +
    `<object id="${assembly}" type="model" name="${xml(title)}"><components>` +
    parts.map((part) => `<component objectid="${part.id}" transform="${identity}"/>`).join("") +
    `</components></object></resources>` +
    `<build><item objectid="${assembly}" transform="${identity}"/></build></model>`;

  const settings =
    `<?xml version="1.0" encoding="UTF-8"?><config><object id="${assembly}">` +
    `<metadata key="name" value="${xml(title)}"/><metadata key="extruder" value="1"/>` +
    parts
      .map(
        (part) =>
          `<part id="${part.id}" subtype="normal_part"><metadata key="name" value="${xml(part.name)}"/>` +
          `<metadata key="extruder" value="${part.slot + 1}"/></part>`,
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
    ["3D/3dmodel.model", document],
    ["Metadata/model_settings.config", settings],
    [
      "Metadata/qr-code.json",
      JSON.stringify({
        filaments: model.filaments.map((colour, index) => ({ slot: index + 1, colour })),
        parts: model.parts.map((part) => ({ name: part.name, slot: part.slot + 1, colour: part.colour })),
        code: { version: model.code.version, level: model.code.level, mask: model.code.mask, modules: model.code.size },
      }),
    ],
  ]);
}

/** Every part in one binary STL, for anything that reads nothing else. STL carries no colours. */
export function stl(model, { title = "QR code" } = {}) {
  const count = model.parts.reduce((total, part) => total + part.triangles.length / 3, 0);
  const bytes = new Uint8Array(84 + count * 50);
  const view = new DataView(bytes.buffer);
  utf8.encodeInto(`${title} - Thingport QR code generator`.slice(0, 79), bytes.subarray(0, 80));
  view.setUint32(80, count, true);
  let at = 84;
  for (const part of model.parts) {
    const point = (index) => [part.vertices[index * 3], part.vertices[index * 3 + 1], part.vertices[index * 3 + 2]];
    for (let i = 0; i < part.triangles.length; i += 3) {
      const a = point(part.triangles[i]);
      const b = point(part.triangles[i + 1]);
      const c = point(part.triangles[i + 2]);
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
  }
  return bytes;
}

/** The settings as a file, so a design can be kept, shared and opened again. */
export const projectFile = (state, version) =>
  `${JSON.stringify({ tool: "thingport-qr-code-generator", version, saved: new Date().toISOString(), state }, null, 2)}\n`;

/** Settings read back from such a file. Throws where the file is something else. */
export function readProject(text) {
  const parsed = JSON.parse(text);
  if (parsed?.tool !== "thingport-qr-code-generator" || typeof parsed.state !== "object") {
    throw new Error("That isn't a QR code project saved by this tool.");
  }
  return parsed.state;
}
