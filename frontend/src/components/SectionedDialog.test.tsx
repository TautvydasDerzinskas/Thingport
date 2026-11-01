import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@mui/material/styles";
import { describe, expect, it, vi } from "vitest";
import en from "../i18n/locales/en.json";
import { buildTheme } from "../theme";
import SectionedDialog, { SectionNavButton, type DialogSection } from "./SectionedDialog";

// The real one renders into a portal, which needs a DOM.
vi.mock("@mui/material/Dialog", () => ({
  default: ({
    open,
    children,
    "aria-labelledby": labelledBy,
  }: {
    open: boolean;
    children: React.ReactNode;
    "aria-labelledby"?: string;
  }) =>
    open ? (
      <dialog open aria-labelledby={labelledBy}>
        {children}
      </dialog>
    ) : null,
}));

const i18n = i18next.createInstance();
await i18n.init({ lng: "en", defaultNS: "common", resources: { en: { common: en.common } } });

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={buildTheme("light")}>{node}</ThemeProvider>
    </I18nextProvider>,
  );

const textOf = (html: string) =>
  html
    .replace(/<style[^>]*>.*?<\/style>/gs, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const occurrences = (html: string, text: string) => html.split(text).length - 1;

const sections: DialogSection<"a" | "b">[] = [
  { id: "a", label: "First", icon: <i data-icon="a" /> },
  { id: "b", label: "Second", icon: <i data-icon="b" />, disabled: true },
];

type DialogProps = Partial<React.ComponentProps<typeof SectionedDialog<"a" | "b">>>;

const dialog = (props: DialogProps = {}) =>
  wrap(
    <SectionedDialog
      open
      onClose={() => undefined}
      title="Settings"
      sections={sections}
      section="a"
      onSectionChange={() => undefined}
      {...props}
    >
      <p>Content</p>
    </SectionedDialog>,
  );

describe("SectionedDialog", () => {
  it("is named after its title", () => {
    const html = dialog();
    const id = html.match(/<dialog open="" aria-labelledby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
  });

  it("lists each section on the side and along the top, with its icon only on the side", () => {
    const html = dialog();
    expect(occurrences(html, "First")).toBe(2);
    expect(occurrences(html, "Second")).toBe(2);
    expect(occurrences(html, 'data-icon="a"')).toBe(1);
    expect(occurrences(html, 'aria-pressed="true"')).toBe(2);
  });

  it("adds nothing for callers that use none of its options", () => {
    const html = dialog();
    expect(textOf(html)).toBe("Settings First Second First Second Content");
    expect(html).not.toContain('aria-label="undefined"');
    expect(occurrences(html, "<nav")).toBe(1);
  });

  it("shows a count's pill, zero included, and none where a section counts nothing", () => {
    const html = dialog({
      sections: [
        { id: "a", label: "First", icon: null, count: 0, countTone: "alert" },
        { id: "b", label: "Second", icon: null },
      ],
    });
    expect(textOf(html)).toBe("Settings First 0 Second First 0 Second Content");
  });

  it("puts the extras where they belong, on both layouts", () => {
    const html = dialog({
      titleExtra: <span>live</span>,
      headerActions: <button type="button">cog</button>,
      railHeader: <span>rail-head</span>,
      railFooter: <span>rail-foot</span>,
    });
    const text = textOf(html);
    expect(text.indexOf("Settings")).toBeLessThan(text.indexOf("live"));
    expect(text.indexOf("live")).toBeLessThan(text.indexOf("cog"));
    expect(occurrences(html, "live")).toBe(1);
    expect(occurrences(html, "rail-head")).toBe(2);
    expect(occurrences(html, "rail-foot")).toBe(2);
    expect(text.indexOf("rail-head")).toBeLessThan(text.indexOf("First"));
    expect(text.indexOf("First")).toBeLessThan(text.indexOf("rail-foot"));
  });

  it("swaps the footer on phones when asked", () => {
    const html = dialog({ railFooter: <span>side-list</span>, phoneRailFooter: <span>phone-select</span> });
    expect(occurrences(html, "side-list")).toBe(1);
    expect(occurrences(html, "phone-select")).toBe(1);
    expect(textOf(html).indexOf("phone-select")).toBeLessThan(textOf(html).indexOf("side-list"));
  });

  it("keeps the icons on phones in the grid layout", () => {
    expect(occurrences(dialog({ phoneNav: "grid" }), 'data-icon="a"')).toBe(2);
  });

  it("names the rail when told what it is, on both layouts", () => {
    const html = dialog({ navLabel: "Sections" });
    expect(occurrences(html, "<nav")).toBe(2);
    expect(occurrences(html, 'aria-label="Sections"')).toBe(2);
  });
});

describe("SectionNavButton", () => {
  it("says which row is chosen", () => {
    const row = (chosen: boolean) =>
      wrap(<SectionNavButton label="Mia" icon={null} chosen={chosen} onClick={() => undefined} />);
    expect(row(true)).toContain('aria-pressed="true"');
    expect(row(false)).toContain('aria-pressed="false"');
  });

  it("keeps the whole of a long name for hovering", () => {
    const html = wrap(
      <SectionNavButton label="Mia" icon={null} chosen={false} onClick={() => undefined} count={2} title="Mia Chen" />,
    );
    expect(html).toContain('title="Mia Chen"');
    expect(textOf(html)).toBe("Mia 2");
  });
});
