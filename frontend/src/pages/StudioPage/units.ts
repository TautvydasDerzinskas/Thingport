import { createContext, useContext } from "react";
import type { Vec3 } from "../../studio/document";
import { MM_PER, type LengthUnit } from "../../studio/expressions";

// The units a design is shown and typed in, as a CAD document's: its own, set from the status bar or Studio settings.
// Sizes are kept in mm whatever they are (in the design, its commands and what an assistant reads); these only change
// how a size reads, and what a bare number typed into a size field means.

export type StudioUnit = LengthUnit;
export const STUDIO_UNITS: StudioUnit[] = ["mm", "cm", "in"];

/** A length's decimals: a hundredth of a millimetre either way. */
const LENGTH_DIGITS: Record<StudioUnit, number> = { mm: 2, cm: 3, in: 3 };
/** As a field shows it, a little finer, so a size typed in comes back as it was typed. */
export const FIELD_DIGITS: Record<StudioUnit, number> = { mm: 3, cm: 4, in: 4 };

/** The open design's units, for every size field in it. */
export const StudioUnitsContext = createContext<StudioUnit>("mm");
export const useDesignUnits = () => useContext(StudioUnitsContext);

const TYPED = /^\s*([-+]?(?:\d+[.,]?\d*|[.,]\d+)(?:e[-+]?\d+)?)\s*(mm|cm|in|")?\s*$/i;

/** A length as typed into a field, in mm: with a unit of its own (2 in, 5mm, 3") in that, otherwise in `units`.
 *  NaN when it isn't a number. */
export function typedLength(text: string, units: StudioUnit): number {
  const found = TYPED.exec(text);
  if (!found) return Number.NaN;
  const value = Number(found[1].replace(",", "."));
  const unit = found[2]?.toLowerCase();
  return value * (unit === '"' ? MM_PER.in : unit ? MM_PER[unit as StudioUnit] : MM_PER[units]);
}

export type UnitFormat = {
  unit: StudioUnit;
  /** A length in mm, in the unit: "12.5 mm", "0.492 in". */
  length: (mm: number) => string;
  /** Three lengths as one size: "40 × 30 × 10 mm". */
  size: (mm: Vec3) => string;
  area: (mm2: number) => string;
  volume: (mm3: number) => string;
  angle: (degrees: number) => string;
};

/** Areas and volumes run over a wide range: as many decimals as keep about four figures. */
const figures = (value: number) => {
  const size = Math.abs(value);
  return size >= 1000 ? 0 : size >= 100 ? 1 : size >= 1 ? 2 : 3;
};

export function unitFormat(unit: StudioUnit, locale: string): UnitFormat {
  const per = MM_PER[unit];
  const fixed = new Intl.NumberFormat(locale, { maximumFractionDigits: LENGTH_DIGITS[unit] });
  const number = (value: number, digits: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  return {
    unit,
    length: (mm) => `${fixed.format(mm / per + 0)} ${unit}`,
    size: (mm) => `${mm.map((side) => fixed.format(side / per + 0)).join(" × ")} ${unit}`,
    area: (mm2) => {
      const value = mm2 / per ** 2;
      return `${number(value, figures(value))} ${unit}²`;
    },
    volume: (mm3) => {
      const value = mm3 / per ** 3;
      return `${number(value, figures(value))} ${unit}³`;
    },
    angle: (degrees) => `${number(degrees, 2)}°`,
  };
}
