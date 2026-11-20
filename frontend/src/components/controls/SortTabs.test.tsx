import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import en from "../../i18n/locales/en.json";
import PrintSortTabs from "../../pages/ModelsPage/SortTabs";
import SortTabs from "./SortTabs";

const i18n = i18next.createInstance();
await i18n.init({ lng: "en", resources: { en: { models: en.models } } });

const render = (node: React.ReactNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

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
      expect(original).toContain(`>${label}</button>`);
      expect(reversed).toContain(`>${reverseLabel}</button>`);
      expect(reversed).not.toContain(`>${label}</button>`);
    },
  );

  it("keeps inactive sort labels at their defaults", () => {
    const html = render(<PrintSortTabs search value="popular" direction="asc" {...callbacks} />);
    expect(html).toContain(">Newest</button>");
    expect(html).toContain(">Downloads</button>");
    expect(html).toContain(">Least popular</button>");
  });

  it("preserves Oldest as the default label where dates start ascending", () => {
    const options = [{ value: "newest", label: "Oldest", reverseLabel: "Newest", defaultDirection: "asc" }] as const;
    const view = (direction: "asc" | "desc") =>
      render(<SortTabs value="newest" options={[...options]} direction={direction} {...callbacks} />);
    expect(view("asc")).toContain(">Oldest</button>");
    expect(view("desc")).toContain(">Newest</button>");
  });
});
