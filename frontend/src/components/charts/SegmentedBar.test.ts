import { describe, expect, it } from "vitest";
import { getContrastRatio } from "@mui/material/styles";
import { buildTheme, THEME_IDS } from "../../theme";
import { inkOn } from "./SegmentedBar";

describe("a bar part's value", () => {
  it.each(THEME_IDS)("reads at 4.5:1 or more on every chart colour of the %s theme", (id) => {
    const theme = buildTheme(id);
    const { series, other } = theme.thingport.chart;
    const weak = [...series, other].filter(
      (color) => getContrastRatio(inkOn(color, theme.palette.common), color) < 4.5,
    );
    expect(weak).toEqual([]);
  });
});
