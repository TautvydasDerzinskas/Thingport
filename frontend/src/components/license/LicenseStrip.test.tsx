import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@mui/material/styles";
import { describe, expect, it, vi } from "vitest";
import type { License } from "../../api/prints";
import en from "../../i18n/locales/en.json";
import { buildTheme } from "../../theme";
import LicenseStrip, { licenseSummary } from "./LicenseStrip";

vi.mock("../ToastProvider", () => ({ useToast: () => () => undefined }));
// There's no DOM to click in: each button rendered is kept, to press by its label.
const buttons = vi.hoisted(() => [] as { children?: React.ReactNode; onClick?: () => void }[]);
vi.mock("@mui/material/Button", () => ({
  default: (props: { children?: React.ReactNode; onClick?: () => void }) => {
    buttons.push(props);
    return <button type="button">{props.children}</button>;
  },
}));
// A closed popover renders nothing without a DOM; its details are what's checked here.
vi.mock("@mui/material/Popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const i18n = i18next.createInstance();
await i18n.init({
  lng: "en",
  defaultNS: "models",
  ns: ["models", "common", "providers"],
  resources: { en: { models: en.models, common: en.common, providers: en.providers } },
  interpolation: { escapeValue: false },
});

const license = (fields: Partial<License>): License => ({
  id: "x",
  short: "X",
  name: "X",
  url: null,
  family: "site",
  marks: [],
  allows: [],
  requires: { credit: false, same_license: false },
  terms: null,
  source: "provider",
  provider: "makerworld",
  ...fields,
});

const strip = (props: Partial<React.ComponentProps<typeof LicenseStrip>>) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={buildTheme("light")}>
        <LicenseStrip
          license={null}
          loading={false}
          provider="makerworld"
          credit={{ title: "Dragon", creator: null, sourceUrl: null }}
          {...props}
        />
      </ThemeProvider>
    </I18nextProvider>,
  );

describe("the licence strip", () => {
  it("doesn't read personal use into a licence that reserves every right", () => {
    const t = i18n.t.bind(i18n);
    expect(licenseSummary(license({ family: "site" }), t)).toBe("Personal use only");
    expect(licenseSummary(license({ family: "reserved" }), t)).toBe("No rights given");
  });

  it("tells a read that failed from a site that stated none, and offers to retry it", () => {
    expect(strip({})).toContain("Not stated by MakerWorld");
    const onRetry = vi.fn<() => void>();
    buttons.length = 0;
    const failed = strip({ failed: true, onRetry });
    expect(failed).toContain("Couldn&#x27;t read the licence from MakerWorld");
    expect(failed).not.toContain("Not stated");
    buttons.find((button) => button.children === "Retry")?.onClick?.();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("says which site a licence was read from, after the model's source is cleared too", () => {
    const read = license({ id: "CC-BY-4.0", family: "cc", source: "provider", provider: "makerworld" });
    expect(strip({ license: read, provider: null })).toContain("As MakerWorld lists it");
    expect(strip({ license: { ...read, source: "user", provider: null }, provider: null })).toContain(
      "Picked by its owner",
    );
  });
});
