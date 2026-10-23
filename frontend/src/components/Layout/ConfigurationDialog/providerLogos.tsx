// Glyphs from Simple Icons (CC0). MakerWorld has none of its own there, so it takes Bambu Lab's,
// whose site it is. MyMiniFactory isn't there either; its glyph is its own favicon, scaled to 24.
// Snapmaker Space and the coming-soon sites aren't there either; theirs are the marks from their own sites, cut from
// the wordmark where the two are one drawing. MakerOnline and Snapmaker Space are black-and-white marks, so they take
// the text colour to show in both themes.
export type ProviderId =
  | "makerworld"
  | "thingiverse"
  | "printables"
  | "myminifactory"
  | "thangs"
  | "cults3d"
  | "makeronline"
  | "crealitycloud"
  | "nexprint"
  | "snapmaker";

/** Sites shown as "Coming soon": listed, but nothing can be done with them yet. */
export const COMING_SOON_PROVIDERS: { id: ProviderId; name: string }[] = [];

type Logo = {
  /** Defaults to 0 0 24 24, Simple Icons' box. */
  viewBox?: string;
  color: string;
  path: string;
  fillRule?: "evenodd";
  /** Shapes in colours of their own, drawn after `path`. */
  layers?: { d: string; color: string }[];
};

const LOGOS: Record<ProviderId, Logo> = {
  makerworld: {
    color: "#00AE42",
    path: "M12.662 24V8.959l8.535 3.369V24zm-9.859-.003v-7.521l8.534-3.371-.001 10.892zM2.803 0h8.533l.001 11.672-8.534 3.369zm9.859 0h8.535v10.892l-8.535-3.371z",
  },
  thingiverse: {
    color: "#248BFB",
    path: "M11.955.005C5.425-.152-.091 5.485.007 11.805c-.235 6.756 5.537 12.25 12.052 12.196C18.621 23.9 23.912 18.595 24 12.03 24.031 5.483 18.505-.18 11.955.005zm-.047 1.701a10.276 10.276 0 0 1 7.36 17.529 10.275 10.275 0 0 1-17.556-7.287C1.71 6.308 6.268 1.728 11.907 1.706zm-5.55 4.781c-.322 0-.358.033-.358.361v2.248c0 .351.04.391.398.391h3.823c.274 0 .274.004.274.265v9.736a.176.176 0 0 0 .051.146c.04.038.093.059.148.053h2.555c.247-.003.283-.035.283-.28v-9.32c0-.124.004-.239 0-.39s.055-.21.218-.21h3.9c.319.004.35-.032.35-.344V6.855c0-.34-.024-.363-.37-.363h-5.626z",
  },
  thangs: {
    color: "#FFBC00",
    path: "M20.18 13.902a1.902 1.902 0 1 1 0-3.804 1.902 1.902 0 0 1 0 3.804m0-5.722A3.82 3.82 0 0 0 16.36 12v3.82h3.82a3.82 3.82 0 1 0 0-7.64m-8.656 5.722A1.907 1.907 0 0 1 9.611 12c0-1.05.857-1.902 1.913-1.902s1.913.852 1.913 1.902c0 1.05-.857 1.902-1.913 1.902m-7.683 0A1.907 1.907 0 0 1 1.928 12c0-1.05.857-1.902 1.913-1.902 1.057 0 1.913.852 1.913 1.902 0 1.05-.856 1.902-1.913 1.902m11.514-2.107-.002-.032a3.76 3.76 0 0 0-.04-.37l-.004-.019a3.693 3.693 0 0 0-.081-.373V11a3.836 3.836 0 0 0-3.704-2.82H3.84a3.833 3.833 0 0 0-3.794 3.254l-.001.008c-.018.118-.03.236-.036.357l-.002.02v.016C.006 11.89 0 11.945 0 12c0 .07.007.137.01.206l.002.032c.008.124.021.248.041.37l.003.018a3.833 3.833 0 0 0 3.786 3.194h11.523V12c0-.07-.006-.137-.01-.205",
  },
  printables: {
    color: "#FA6831",
    path: "M3.678 4.8 12 9.6v9.6l8.322-4.8V4.8L12 0ZM12 19.2l-8.322-4.8V24Z",
  },
  myminifactory: {
    color: "#00C4A6",
    path: "M24 0.241V23.759a0.241 0.241 0 0 1 -0.241 0.241H14.4V19.201h4.801V7.2H14.4V14.4H9.6V7.2H4.799v12.001H9.6v4.799H0.481A0.481 0.481 0 0 1 0 23.519V0.241A0.241 0.241 0 0 1 0.241 0H23.759A0.241 0.241 0 0 1 24 0.241Z",
  },
  cults3d: {
    viewBox: "0 0 260 260",
    color: "#822EF5",
    path: "M56.145 84.655c-20.238 13.483-33.613 36.496-33.613 62.586 0 41.448 33.725 75.168 75.167 75.168 12.086 0 23.497-2.879 33.62-7.964l-.021-.011-.13-.068c10.161 5.134 21.63 8.043 33.771 8.043 41.45 0 75.173-33.72 75.173-75.168 0-26.113-13.396-49.149-33.663-62.626-2.059-39.665-34.973-71.3-75.14-71.3-40.106 0-72.977 31.542-75.13 71.118l-.034.222zm17.165-8.664c5.779-26.71 29.585-46.787 58.001-46.787 32.728 0 59.353 26.626 59.353 59.354 0 17.274-7.424 32.845-19.238 43.702l-8.281-4.747-15.918 9.123 25.565 14.658c16.324-10.833 28.196-27.854 32.24-47.693 11.799 10.846 19.203 26.394 19.203 43.642 0 32.695-26.601 59.293-59.297 59.293-28.389 0-52.215-20.051-57.995-46.732l8.458-4.879v-18.245l-25.569 14.694c1.14 20.876 10.864 39.506 25.658 52.447l-.007-.017c-5.621 1.775-11.583 2.731-17.785 2.731-32.696 0-59.292-26.598-59.292-59.293 0-32.696 26.595-59.298 59.292-59.298 6.207 0 12.187.962 17.807 2.734l.037 9.626 15.859 9.063v-29.332c-10-5.084-21.58-7.965-33.661-7.965-8.555 0-16.797 1.443-24.466 4.09l.036-.169z",
  },
  makeronline: {
    viewBox: "0.15 -10.2 50 50",
    color: "currentColor",
    fillRule: "evenodd",
    path: "M13.036 4.95V.25l11.99 11.988v4.701L13.035 4.951Zm11.99 12.296L12.917 5.14.812 17.246l12.106 12.106 12.107-12.106Zm24.452 0L37.371 5.14 25.265 17.246 37.37 29.352l12.107-12.106ZM12.807.25.817 12.238v4.701l11.99-11.988V.25Zm24.674 4.7V.25l11.99 11.988v4.701L37.48 4.951Zm-.23-4.7L25.263 12.238v4.701l11.99-11.988V.25Z",
  },
  // Its own mark is grey in shades of opacity; these are the greens of its favicon, face by face.
  crealitycloud: {
    viewBox: "0 -30 1084 1084",
    color: "#06AE4A",
    path: "M271.36 0L542.117647 185.012706l-271.058823 183.115294-271.058824-183.115294z",
    layers: [
      { color: "#31BA4F", d: "M0 185.012706l271.058824 183.115294 0.421647 472.847059L0 661.985882z" },
      { color: "#005F33", d: "M812.634353 0L1084.235294 185.012706l-271.058823 183.175529-271.058824-183.175529z" },
      {
        color: "#116A2A",
        d: "M1084.235294 185.012706l-271.088941 183.115294-1.385412 474.473412L1084.235294 661.985882z",
      },
      { color: "#127136", d: "M542.117647 185.012706l271.058824 183.115294-270.968471 186.729412L271.058824 368.128z" },
      { color: "#1F813A", d: "M813.176471 368.128l-270.968471 186.729412L542.087529 1024l269.70353-181.398588z" },
      { color: "#2AA545", d: "M271.058824 368.128l270.998588 186.729412L542.117647 1024l-271.058823-183.055059z" },
    ],
  },
  // Its own fill is an angular gradient; this is the gradient's lighter end.
  nexprint: {
    viewBox: "0 -0.97 30 30",
    color: "#7A55E3",
    path: "M15 18.5519L19.1113 12.0919H25.6592C26.2106 12.0921 26.7007 12.4444 26.877 12.9669L29.9307 22.0236C30.2114 22.8566 29.592 23.7198 28.7129 23.7198H1.28613C0.407131 23.7196 -0.212382 22.8566 0.0683594 22.0236L3.12305 12.9669C3.29939 12.4443 3.78924 12.0919 4.34082 12.0919H10.8877L7.21191 6.31555C6.66766 5.45993 7.2819 4.34031 8.2959 4.33997H21.7002C22.7143 4.34001 23.3292 5.45985 22.7852 6.31555L19.1094 12.0919H10.8887L15 18.5519Z",
  },
  // A white S on a black disc; the S is cut out instead, so the disc can take the text colour.
  snapmaker: {
    viewBox: "0 0 36 36",
    color: "currentColor",
    fillRule: "evenodd",
    path: "M18 0a18 18 0 1 0 0 36a18 18 0 1 0 0-36ZM23.2899 9.13976C21.7574 8.82421 20.5055 9.02036 19.5311 9.72254C18.5567 10.4247 17.8864 11.6016 17.5232 13.2505L16.3835 18.396H16.3864L15.3677 22.9928C15.1758 23.8627 14.8864 24.4711 14.5026 24.8207C14.1187 25.1704 13.5842 25.2727 12.9022 25.1334C12.4593 25.0425 11.9868 24.8776 11.4789 24.6388L10.9238 27.1291C11.414 27.3792 12.0104 27.5754 12.7132 27.7175C14.2457 28.0331 15.4976 27.8369 16.472 27.1348C17.4464 26.4326 18.1167 25.2557 18.4799 23.6068L19.6197 18.4613H19.6167L20.6354 13.8645C20.8273 12.9946 21.1167 12.3863 21.5006 12.0366C21.8844 11.6869 22.4189 11.5846 23.1009 11.7239C23.5439 11.8148 24.0163 11.9797 24.5242 12.2185L25.0763 9.72538C24.5891 9.4809 23.9927 9.28475 23.2899 9.13976Z",
  },
};

/** Whether a provider name, such as a model's source, is one there's a logo for. */
export function hasProviderLogo(id: string | null | undefined): id is ProviderId {
  return !!id && Object.hasOwn(LOGOS, id);
}

/** A provider's logo as SVG markup, to show as an image; its black-and-white marks are drawn in black. */
export function providerLogoSvg(id: ProviderId): string {
  const { viewBox = "0 0 24 24", color, path, fillRule, layers } = LOGOS[id];
  const fill = (value: string) => (value === "currentColor" ? "#000" : value);
  const paths = [
    `<path d="${path}" fill="${fill(color)}"${fillRule ? ` fill-rule="${fillRule}"` : ""}/>`,
    ...(layers ?? []).map((layer) => `<path d="${layer.d}" fill="${fill(layer.color)}"/>`),
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${paths.join("")}</svg>`;
}

export const PROVIDER_LOGO_IDS = Object.keys(LOGOS) as ProviderId[];

export function ProviderLogo({ id, size }: { id: ProviderId; size: number }) {
  const { viewBox = "0 0 24 24", color, path, fillRule, layers } = LOGOS[id];
  return (
    <svg width={size} height={size} viewBox={viewBox} aria-hidden="true" style={{ display: "block" }}>
      <path d={path} fill={color} fillRule={fillRule} />
      {layers?.map((layer) => (
        <path key={layer.d} d={layer.d} fill={layer.color} />
      ))}
    </svg>
  );
}
