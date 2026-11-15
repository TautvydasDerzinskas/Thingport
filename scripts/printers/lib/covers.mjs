// Each printer's picture, from the first source that has one, as a small WebP: most slicers ship them at 240 px, a
// few at several times that and one at 19 MB. Uses the backend's sharp, which Thingport already depends on.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const SIZE = 256;

export async function writeCovers(printers, dir, backendDir) {
  const sharp = createRequire(path.join(backendDir, "package.json"))("sharp");
  mkdirSync(dir, { recursive: true });
  const wanted = new Set();
  let bytes = 0;
  const failed = [];
  for (const p of printers) {
    if (!p.coverFrom) continue;
    const file = `${p.id}.webp`;
    try {
      const out = await sharp(p.coverFrom)
        .resize({ width: SIZE, height: SIZE, fit: "inside", withoutEnlargement: true })
        // sharp's default effort: its highest took 2 s a picture for 2% less.
        .webp({ quality: 80 })
        .toBuffer();
      writeFileSync(path.join(dir, file), out);
      wanted.add(file);
      bytes += out.length;
    } catch (err) {
      failed.push(`${p.id}: ${err.message}`);
    }
  }
  for (const name of readdirSync(dir)) if (!wanted.has(name)) rmSync(path.join(dir, name));
  return { count: wanted.size, bytes, failed, has: (id) => wanted.has(`${id}.webp`) };
}
