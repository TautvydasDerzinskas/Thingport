// Today's edition of the icon, for the popup and the floating icon (see seasonalMark.ts). The overlays are bundled
// where they're shown: the popup, and the background, which hands the content script its one.

import aprilFools from "../assets/seasonal/aprilfools.svg";
import autumn from "../assets/seasonal/autumn.svg";
import birthday from "../assets/seasonal/birthday.svg";
import christmas from "../assets/seasonal/christmas.svg";
import coffee from "../assets/seasonal/coffee.svg";
import diwali from "../assets/seasonal/diwali.svg";
import easter from "../assets/seasonal/easter.svg";
import halloween from "../assets/seasonal/halloween.svg";
import hanukkah from "../assets/seasonal/hanukkah.svg";
import holi from "../assets/seasonal/holi.svg";
import jonines from "../assets/seasonal/jonines.svg";
import lunarNewYear from "../assets/seasonal/lunarnewyear.svg";
import muertos from "../assets/seasonal/muertos.svg";
import newYear from "../assets/seasonal/newyear.svg";
import programmersDay from "../assets/seasonal/programmersday.svg";
import ramadan from "../assets/seasonal/ramadan.svg";
import saltibarsciai from "../assets/seasonal/saltibarsciai.svg";
import spring from "../assets/seasonal/spring.svg";
import stPatricks from "../assets/seasonal/stpatricks.svg";
import summer from "../assets/seasonal/summer.svg";
import valentines from "../assets/seasonal/valentines.svg";
import winter from "../assets/seasonal/winter.svg";
import womensDay from "../assets/seasonal/womensday.svg";
import { seasonFor, type Season } from "./season";
import { composeSeasonalMark, svgDataUrl, type SeasonalIcon } from "./seasonalMark";

const OVERLAYS: Partial<Record<Season, string>> = {
  newYear,
  lunarNewYear,
  valentines,
  holi,
  womensDay,
  stPatricks,
  spring,
  ramadan,
  aprilFools,
  easter,
  saltibarsciai,
  summer,
  jonines,
  birthday,
  programmersDay,
  autumn,
  coffee,
  diwali,
  halloween,
  muertos,
  hanukkah,
  winter,
  christmas,
};

/** What to dress the icon in today; null on an ordinary day. */
export function seasonalIcon(date = new Date()): SeasonalIcon | null {
  const season = seasonFor(date);
  if (!season) return null;
  const overlay = OVERLAYS[season];
  return {
    season,
    overlay: overlay ? svgDataUrl(composeSeasonalMark(season, overlay)) : null,
    dodge: season === "aprilFools",
  };
}
