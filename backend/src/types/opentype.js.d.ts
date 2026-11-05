// What the backend uses of opentype.js, which reads Studio's fonts (services/studioFonts.ts). @types/opentype.js would
// bring the DOM's types in with it, which the server's own fetch and Headers types aren't.
declare module "opentype.js" {
  /** A TTF or OTF file, parsed: the shape studio/text.generated.ts's TextFont describes. */
  export function parse(buffer: ArrayBuffer): unknown;
}
