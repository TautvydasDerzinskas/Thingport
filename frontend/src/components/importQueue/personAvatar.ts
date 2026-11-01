import { accentSwatch, type AccentColor } from "../../theme";

// Graphite is left out: it nearly disappears on the dark theme's panels.
const COLORS: AccentColor[] = ["blue", "orange", "amber", "teal", "purple", "green"];

const SHAPES = [
  { id: "hexagon", path: "M12 2l8.66 5v10L12 22l-8.66-5V7z" },
  { id: "diamond", path: "M12 3l9 9-9 9-9-9z" },
  { id: "triangle", path: "M12 3.5 21.5 20h-19z" },
  { id: "square", path: "M5 5h14v14H5z" },
  { id: "circle", path: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" },
] as const;

export type PersonAvatar = {
  background: string;
  /** Reads on `background`, in both themes. */
  foreground: string;
  shape: (typeof SHAPES)[number]["id"];
  /** The shape, for a 24 by 24 viewBox. */
  path: string;
};

// FNV-1a. crypto.subtle isn't there on a plain HTTP instance, and nothing here needs to be secret: the key already is.
function hash(key: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    value ^= key.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** What someone in the line looks like: told apart from the others without saying who they are. */
export function personAvatar(person: string): PersonAvatar {
  const value = hash(person);
  const { color, contrast } = accentSwatch(COLORS[value % COLORS.length]);
  // Other bits than the colour's, so two people of one colour don't always share a shape too.
  const { id, path } = SHAPES[(value >>> 8) % SHAPES.length];
  return { background: color, foreground: contrast, shape: id, path };
}
