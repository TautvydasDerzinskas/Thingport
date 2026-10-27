// What the print costs and what to charge for it. Numbers in, numbers out: nothing here knows about the window.
//
// The cost of a printed part is mostly not its filament, which is the point of showing it layer by layer: the hours
// the machine spends wearing itself out, the prints that fail and are paid for by the ones that don't, and the time
// spent pulling off supports are all real money, and leaving any of them out is how a part gets sold at a loss.

/** What the person charges for, beyond the print itself. */
export const BUSINESS = {
  currency: "€",
  hourlyRate: 15,
  postMinutes: 10,
  packaging: 0.8,
  fee: 8,
  margin: 40,
};

/** The layers of the cost, bottom to top, with the colours the chart draws them in. Light and dark are both chosen
 *  for their own surface rather than one being a wash of the other: slots 1 to 6 of Thingport's categorical palette,
 *  in order, which hold apart for colour blindness on both. */
export const LAYERS = [
  { key: "material", name: "Material", light: "#2a78d6", dark: "#3987e5" },
  { key: "power", name: "Power", light: "#eb6834", dark: "#d95926" },
  { key: "depreciation", name: "Machine", light: "#1baf7a", dark: "#199e70" },
  { key: "failures", name: "Failures", light: "#eda100", dark: "#c98500" },
  { key: "labour", name: "Your time", light: "#e87ba4", dark: "#d55181" },
  { key: "packaging", name: "Packaging", light: "#008300", dark: "#008300" },
];

/**
 * The cost of one part and the price to sell it at.
 *
 * `input` is { grams, purgeGrams, hours, quantity } for the print, and the printer, material and business figures
 * flattened in beside them.
 */
export function price(input) {
  const hours = Math.max(0, input.hours || 0);
  const perGram = input.spoolWeight > 0 ? input.spoolPrice / input.spoolWeight : 0;

  const material = Math.max(0, (input.grams || 0) + (input.purgeGrams || 0)) * perGram;
  const power = (Math.max(0, input.watts) / 1000) * hours * Math.max(0, input.kwhPrice);
  // The machine is spread over the hours it's expected to last, the way any shop writes a machine off.
  const depreciation = input.lifespan > 0 ? hours * (Math.max(0, input.price) / input.lifespan) : 0;
  // Eight prints in a hundred going in the bin means the ninety-two that come out have to pay for them: the filament
  // and the hours went the same way whether the print worked or not, so the rate is taken on those three.
  const failures = (material + power + depreciation) * (Math.min(Math.max(input.failRate, 0), 95) / 100);
  const labour = (Math.max(0, input.postMinutes) / 60) * Math.max(0, input.hourlyRate);
  const packaging = Math.max(0, input.packaging);

  const parts = { material, power, depreciation, failures, labour, packaging };
  const cost = Object.values(parts).reduce((total, part) => total + part, 0);

  // A platform's cut is taken from the price it sells at, not from the cost, so the price has to be divided by what's
  // left of it rather than have the fee added on: at 10% and a €10 cost, €11 leaves €9.90, and €11.11 leaves €10.
  const fee = Math.min(Math.max(input.fee, 0), 95) / 100;
  const recommended = (cost * (1 + Math.max(input.margin, -99) / 100)) / (1 - fee);
  const kept = recommended * (1 - fee) - cost;

  const quantity = Math.max(1, Math.floor(input.quantity || 1));
  const charged = Math.max(0, input.currentPrice || 0);
  const profit = charged * (1 - fee) - cost;

  return {
    parts,
    cost,
    recommended,
    kept,
    quantity,
    orderCost: cost * quantity,
    orderPrice: recommended * quantity,
    // What the person makes at the price they charge today, which is the number that changes a mind.
    charged,
    profit,
    margin: cost > 0 ? (profit / cost) * 100 : 0,
    perHour: hours > 0 ? profit / hours : 0,
    materialShare: cost > 0 ? (material / cost) * 100 : 0,
  };
}
