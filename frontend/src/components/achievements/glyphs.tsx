import type React from "react";
import type { Glyph } from "../../constants/achievements";
import { MANIFESTS, type Logo, type ProviderId } from "../../providers/index.generated";

// What a badge is for, drawn on a 40 by 40 grid in `currentColor` strokes: the sticker's ink.

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 4.2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** The guest from the weather scene: the Thingport mark out for a walk, in the sunglasses it wears in summer. */
export function GuestFigure() {
  const ink = "#1f1f1f";
  return (
    <g>
      <g stroke={ink} strokeWidth="5" strokeLinecap="round" fill="none">
        <path d="M40 70V96M60 70V96M22 46 11 66M78 46 89 34" />
      </g>
      <ellipse cx="43" cy="98" rx="7.5" ry="4" fill="#00b800" stroke={ink} strokeWidth="2" />
      <ellipse cx="63" cy="98" rx="7.5" ry="4" fill="#00b800" stroke={ink} strokeWidth="2" />
      <circle cx="10" cy="68" r="5.6" fill="#fff" stroke={ink} strokeWidth="2.4" />
      <circle cx="90" cy="32" r="5.6" fill="#fff" stroke={ink} strokeWidth="2.4" />
      <g transform="translate(10 0)">
        <path
          fill="#fff"
          stroke={ink}
          strokeWidth="5.27"
          strokeLinejoin="round"
          d="M35.382 11.301Q40 8.635 44.618 11.301L62.545 21.651Q67.163 24.317 67.163 29.650L67.163 50.350Q67.163 55.682 62.545 58.349L44.618 68.699Q40 71.365 35.382 68.699L17.455 58.349Q12.837 55.683 12.837 50.350L12.837 29.650Q12.837 24.318 17.455 21.651Z"
        />
        <path
          fill="#00b800"
          d="M36.517 39.397Q38.781 40.704 38.781 43.318L38.781 55.385Q38.781 57.999 36.517 56.692L26.067 50.659Q23.803 49.352 23.803 46.737L23.803 34.671Q23.803 32.056 26.067 33.363Z"
        />
        <path
          fill="#00b800"
          d="M41.219 43.318Q41.219 40.704 43.483 39.397L53.933 33.363Q56.197 32.056 56.197 34.671L56.197 46.737Q56.197 49.352 53.933 50.659L43.483 56.692Q41.219 57.999 41.219 55.385Z"
        />
      </g>
      <path fill="none" stroke={ink} strokeWidth="4" d="M47 31Q50 27 53 31" />
      <g fill="#14161b" stroke={ink} strokeWidth="2">
        <rect x="17" y="22" width="31" height="24" rx="10" />
        <rect x="52" y="22" width="31" height="24" rx="10" />
      </g>
      <path
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.8"
        d="M24 32 30 27M57 32 63 27"
      />
    </g>
  );
}

function providerGlyph(id: ProviderId): React.ReactNode {
  const logo: Logo = MANIFESTS[id].brand.logo;
  const width = Number((logo.viewBox ?? "0 0 24 24").split(" ")[2]) || 24;
  return (
    <g transform={`translate(3 3) scale(${34 / width})`}>
      <path d={logo.path} fill="currentColor" fillRule={logo.fillRule} />
      {logo.layers?.map((layer) => (
        <path key={layer.d} d={layer.d} fill="currentColor" fillRule={layer.fillRule} opacity={0.75} />
      ))}
    </g>
  );
}

export function glyphArt(glyph: Glyph): React.ReactNode {
  if (glyph.startsWith("provider:")) return providerGlyph(glyph.slice("provider:".length) as ProviderId);
  switch (glyph) {
    case "download":
      return (
        <g {...STROKE}>
          <path d="M20 5V25M12 17.5 20 25.5 28 17.5M6 25V33.5H34V25" />
        </g>
      );
    case "import":
      return (
        <g {...STROKE} strokeWidth={3.8}>
          <path d="M20 14 33 20.5V31L20 37.5 7 31V20.5Z" />
          <path d="M7 20.5 20 27 33 20.5M20 27V37.5M20 1.5V12M15.5 7.5 20 12 24.5 7.5" />
        </g>
      );
    case "regular":
      return (
        <g {...STROKE}>
          <rect x="5" y="8" width="30" height="27" rx="4" />
          <path d="M5 16H35M13 4V11M27 4V11M13 25.5 18 30 27.5 21" />
        </g>
      );
    case "studio":
      return (
        <g {...STROKE} strokeWidth={3.6}>
          <path d="M15 12 27 18.5V31L15 37.5 3 31V18.5Z" />
          <path d="M3 18.5 15 25 27 18.5M15 25V37.5" />
          <path d="M24.5 27.5 34 5.5 39 7.5 29.5 29.5 24.5 33Z" strokeWidth={3.2} />
        </g>
      );
    case "sync":
      return (
        <g {...STROKE}>
          <path d="M33 16A14 14 0 0 0 8.5 13M33.5 6.5V16.5H23.5M7 24A14 14 0 0 0 31.5 27M6.5 33.5V23.5H16.5" />
        </g>
      );
    case "sources":
      return (
        <g {...STROKE} strokeWidth={3.8}>
          <path d="M6 5 15 16M20 3V15M34 5 25 16" />
          <path d="M6 23H34V35H6Z" />
          <path d="M14 29H26" />
        </g>
      );
    case "keyring":
      return (
        <g {...STROKE} strokeWidth={3.6}>
          <circle cx="11" cy="12" r="8" />
          <rect x="13" y="16" width="24" height="18" rx="5" />
          <circle cx="19" cy="22" r="1.2" strokeWidth={3} />
          <path d="M24 28H31" />
        </g>
      );
    case "qr":
      return (
        <g {...STROKE} strokeWidth={3.4}>
          <rect x="5" y="5" width="11" height="11" rx="1.5" />
          <rect x="24" y="5" width="11" height="11" rx="1.5" />
          <rect x="5" y="24" width="11" height="11" rx="1.5" />
          <path d="M24 24H28M32 24V28M24 30V35M29 33H35" />
        </g>
      );
    case "gridfinity":
      return (
        <g {...STROKE} strokeWidth={3.6}>
          <rect x="4" y="4" width="14.5" height="14.5" rx="3" />
          <rect x="21.5" y="4" width="14.5" height="14.5" rx="3" />
          <rect x="4" y="21.5" width="32" height="14.5" rx="3" />
        </g>
      );
    case "enclosure":
      return (
        <g {...STROKE} strokeWidth={3.8}>
          <path d="M5 15H35V35H5ZM3 8H37V15H3ZM16 23H24" />
        </g>
      );
    case "multiboard":
      return (
        <g {...STROKE} strokeWidth={3.4}>
          <path d="M12 4 19 8V16L12 20 5 16V8Z" />
          <path d="M28 4 35 8V16L28 20 21 16V8Z" />
          <path d="M20 20 27 24V32L20 36 13 32V24Z" />
        </g>
      );
    case "skadis":
      return (
        <g {...STROKE} strokeWidth={3.6}>
          <rect x="4" y="4" width="32" height="32" rx="4" />
          <path d="M13 11V17M20 18V24M27 11V17M13 25V31M27 25V31" />
        </g>
      );
    case "openscad":
      return (
        <g {...STROKE} strokeWidth={3.6}>
          <path d="M5 10H35M5 20H35M5 30H35" />
          <circle cx="14" cy="10" r="3.6" fill="currentColor" />
          <circle cx="27" cy="20" r="3.6" fill="currentColor" />
          <circle cx="18" cy="30" r="3.6" fill="currentColor" />
        </g>
      );
    case "normalize":
      return (
        <g {...STROKE} strokeWidth={3.6}>
          <path d="M9 3H25L32 10V37H9Z" />
          <path d="M25 3V10H32M14 23 19 28 27 19" />
        </g>
      );
    case "guest":
      return null;
  }
}
