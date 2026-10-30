/** Each provider's logo, a white tile (docs/assets/providers/<slug>.svg, written by scripts/sync-providers.mjs), as its
 *  built URL by the slug in /docs/providers/<slug>/. */
export const PROVIDER_LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<{ default: ImageMetadata }>("../../../../docs/assets/providers/*.svg", { eager: true }),
  ).map(([path, image]) => [path.replace(/^.*\/(.+)\.svg$/, "$1"), image.default.src]),
);
