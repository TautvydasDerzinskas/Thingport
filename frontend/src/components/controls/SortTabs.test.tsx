import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import en from "../../i18n/locales/en.json";
import PrintSortTabs from "../../pages/ModelsPage/SortTabs";
import SortTabs, { sortClick } from "./SortTabs";

const i18n = i18next.createInstance();
await i18n.init({ lng: "en", resources: { en: { models: en.models } } });

const render = (node: React.ReactNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

/** Each button's text, whatever it's wrapped in; Emotion writes its styles into the markup beside the first user. */
const labels = (html: string) =>
  [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(([, inner]) =>
    inner.replace(/<style[^>]*>.*?<\/style>/g, "").replace(/<[^>]+>/g, ""),
  );

const callbacks = { onChange: () => undefined, onDirectionChange: () => undefined };

describe("sort labels", () => {
  it.each([
    ["newest", "desc", "Newest", "Oldest"],
    ["popular", "desc", "Popular", "Least popular"],
    ["downloads", "desc", "Downloads", "Fewest downloads"],
    ["relevance", "desc", "Relevance", "Least relevant"],
    ["name", "asc", "Name", "Name (Z–A)"],
  ] as const)(
    "keeps the default label for %s and shows its opposite when reversed",
    (value, direction, label, reverseLabel) => {
      const original = render(<PrintSortTabs search value={value} direction={direction} {...callbacks} />);
      const reversed = render(
        <PrintSortTabs search value={value} direction={direction === "asc" ? "desc" : "asc"} {...callbacks} />,
      );
      expect(labels(original)).toContain(label);
      expect(labels(reversed)).toContain(reverseLabel);
      expect(labels(reversed)).not.toContain(label);
    },
  );

  it("keeps inactive sort labels at their defaults", () => {
    const html = render(<PrintSortTabs search value="popular" direction="asc" {...callbacks} />);
    expect(labels(html)).toEqual(["Relevance", "Newest", "Least popular", "Downloads", "Name"]);
  });

  it("preserves Oldest as the default label where dates start ascending", () => {
    const options = [{ value: "newest", label: "Oldest", reverseLabel: "Newest", defaultDirection: "asc" }] as const;
    const view = (direction: "asc" | "desc") =>
      render(<SortTabs value="newest" options={[...options]} direction={direction} {...callbacks} />);
    expect(labels(view("asc"))).toEqual(["Oldest"]);
    expect(labels(view("desc"))).toEqual(["Newest"]);
  });

  it("has one button per option and no separate direction button", () => {
    const html = render(<PrintSortTabs value="newest" direction="desc" {...callbacks} />);
    expect(labels(html)).toEqual(["Newest", "Popular", "Downloads", "Name"]);
    expect(html).not.toContain("aria-label");
  });

  it("doesn't animate the labels when they're first drawn", () => {
    expect(render(<PrintSortTabs value="newest" direction="asc" {...callbacks} />)).not.toContain("animation");
  });
});

describe("clicking a sort option", () => {
  it("reverses the chosen option's order", () => {
    expect(sortClick("newest", "desc", "newest")).toEqual({ direction: "asc" });
    expect(sortClick("name", "asc", "name")).toEqual({ direction: "desc" });
  });

  it("chooses another option without touching the order, which it sets to its own default", () => {
    expect(sortClick("newest", "asc", "popular")).toEqual({ value: "popular" });
  });
});
