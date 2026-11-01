import { describe, expect, it, vi } from "vitest";
import { renderQueue } from "../importQueue/testing";
import Segmented from "./Segmented";

vi.mock("../importQueue/ImportQueueContext", () => ({ useImportQueue: () => null }));

const OPTIONS = [
  { value: "mine", label: "Mine" },
  { value: "everyone", label: "Everyone" },
];

/** The rules given to the button with this `aria-pressed`. */
function rulesOf(html: string, pressed: boolean) {
  const button = html.match(new RegExp(`<button[^>]*aria-pressed="${pressed}"[^>]*>`))?.[0] ?? "";
  const className = button.match(/class="[^"]*(css-[\w-]+)/)?.[1] ?? "";
  return [...html.matchAll(/<style[^>]*>(.*?)<\/style>/gs)]
    .map((style) => style[1])
    .filter((css) => css.includes(`.${className}`))
    .join("");
}

const render = (theme: "light" | "dark") =>
  renderQueue(<Segmented label="Whose" value="mine" options={OPTIONS} onChange={() => undefined} />, theme);

describe("Segmented, under the pointer", () => {
  it.each(["light", "dark"] as const)("keeps the chosen option's colour in the %s theme", (theme) => {
    const html = render(theme);
    expect(rulesOf(html, true)).not.toMatch(/:hover\{color:/);
    expect(rulesOf(html, false)).toMatch(/:hover\{color:/);
  });

  it("still brings an unchosen logo out of grey on either", () => {
    const html = render("dark");
    expect(rulesOf(html, true)).toMatch(/:hover>svg\{opacity:1/);
    expect(rulesOf(html, false)).toMatch(/:hover>svg\{opacity:1/);
  });
});
