import { slicerMark } from "../../../adapter/slicers/marks.generated";

/** A slicer's mark, from backend/src/adapter/slicers/marks.ts (Thingport Grab draws the same), for a white tile. */
export function SlicerLogo({ id, size }: { id: string; size: number }) {
  const logo = slicerMark(id);
  return (
    <svg width={size} height={size} viewBox={logo.viewBox} aria-hidden="true" style={{ display: "block" }}>
      {logo.paths.map((path) => (
        <path key={path.d} d={path.d} fill={path.fill} />
      ))}
    </svg>
  );
}
