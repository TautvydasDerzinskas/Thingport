// Each part of the plan as its own 3MF, one per plate of the model the plan is saved as.
//
// They are the plan, not something to print: the boards are plain slabs at their true size, because the real ones
// are AU3D's files and aren't ours to reproduce. What they are good for is seeing each part at its real size, in
// Thingport's viewer or a slicer, and having the library hold one plate per thing you have to print.
//
// Every file says so in its own metadata, so a plate opened on its own still explains itself.

/** Skadis board stock, in mm. */
const THICKNESS_MM = 5;
/** The block that stands in for a mount, in mm across. Its depth is the standoff the plan was made with. */
const MOUNT_MM = 24;

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

/** A ZIP of stored entries. A 3MF of one box gains nothing from deflating, and storing keeps the writer short. */
function zip(entries) {
  const chunks = [];
  const directory = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = utf8.encode(name);
    const data = utf8.encode(text);
    const crc = crc32(data);
    const local = new Uint8Array(30);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 0, true); // stored
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    chunks.push(local, nameBytes, data);

    const central = new Uint8Array(46);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
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

/** A box standing on the plate, wound so its faces point out: 8 corners, 12 triangles. */
function boxMesh(x, y, z) {
  const corners = [
    [0, 0, 0],
    [x, 0, 0],
    [x, y, 0],
    [0, y, 0],
    [0, 0, z],
    [x, 0, z],
    [x, y, z],
    [0, y, z],
  ];
  const faces = [
    [0, 3, 2],
    [0, 2, 1],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  const vertices = corners.map(([vx, vy, vz]) => `<vertex x="${vx}" y="${vy}" z="${vz}"/>`).join("");
  const triangles = faces.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join("");
  return `<mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh>`;
}

const escapeXml = (text) =>
  String(text).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

/** One part, lying on the plate as it would be printed. */
function part3mf({ name, description, x, y, z }) {
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Title">${escapeXml(name)}</metadata>` +
    `<metadata name="Description">${escapeXml(description)}</metadata>` +
    `<metadata name="Application">Thingport Skadis planner</metadata>` +
    `<resources><object id="1" type="model" name="${escapeXml(name)}">${boxMesh(x, y, z)}</object></resources>` +
    `<build><item objectid="1"/></build>` +
    `</model>`;
  return zip([
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
    ],
    ["3D/3dmodel.model", model],
  ]);
}

/** A file name that survives any file system: no slashes, no doubled spaces, and the order kept at the front. */
const fileName = (step, label) =>
  `${String(step).padStart(2, "0")} ${label}`
    .replace(/[^A-Za-z0-9 ()×x+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);

/**
 * Every part of the plan, in print order, one file each: `{ name, data, step }`. These become the plates of the
 * model the plan is saved as, so the library holds one plate per thing there is to print.
 */
export function partFiles(steps, { wallMm = 0 } = {}) {
  return steps.map((step) => {
    const copies = step.count === 1 ? "" : ` x${step.count}`;
    const mirror = step.mirror ? ` ${step.mirror}` : "";
    const label = `${step.name}${mirror}${copies}`;
    const description =
      step.kind === "board"
        ? `${step.detail}. Print ${step.count}${step.mirror ? `, ${step.mirror}` : ""}. ` +
          `The board itself is ${step.from ?? "AU3D's file"}${step.file ? `, file "${step.file}"` : ""}` +
          `${step.turned ? ", printed a quarter turn round" : ""} — this plate is the plan at its true size, not that file.`
        : `Print ${step.count}. ${step.detail}. The mount itself is ${step.from ?? "AU3D's file"} — this plate ` +
          "stands in for it at the standoff the plan uses, and is not that file.";
    const box =
      step.kind === "board"
        ? { x: step.widthMm, y: step.heightMm, z: THICKNESS_MM }
        : { x: MOUNT_MM, y: MOUNT_MM, z: Math.max(4, wallMm) };
    return {
      step: step.step,
      name: `${fileName(step.step, label)}.3mf`,
      data: part3mf({ name: label, description, ...box }),
    };
  });
}
