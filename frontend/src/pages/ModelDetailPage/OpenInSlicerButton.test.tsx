import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en.json";
import OpenInSlicerButton from "./OpenInSlicerButton";
import type { NormalizeState } from "./useNormalizedOpen";
import type { ModelFile, SlicerTarget } from "./useOpenInSlicer";

// The menu entry for a normalized copy: a copy that took too long to launch on the first click waits for a second one,
// and the entry has to say so rather than look as if nothing happened.

// The real menu renders into a portal and only while open, which needs a DOM.
vi.mock("@mui/material/Menu", () => ({
  default: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>,
}));
vi.mock("../../hooks/useSlicerPreference", () => ({
  useSlicerSettings: () => ({ bridged: [] }),
  switchSlicer: async () => undefined,
}));
// The plain entries' links are built against the page's address.
vi.mock("./useOpenInSlicer", async (original) => ({
  ...(await original<typeof import("./useOpenInSlicer")>()),
  slicerHref: () => "orcaslicer://open",
}));

const i18n = i18next.createInstance();
await i18n.init({ lng: "en", defaultNS: "models", resources: { en: { models: en.models } } });

const file: ModelFile = {
  key: "f1",
  url: "/files/f1.3mf",
  filename: "part.3mf",
  launchFilename: "part.3mf",
  index: 0,
  plate: null,
};
const target: SlicerTarget = { ...file, href: "orcaslicer://open?file=x", normalizeTarget: "orca" };
const orca = { id: "snapmaker-orca", label: "Snapmaker Orca" };

function render(state: NormalizeState): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <OpenInSlicerButton
        file={file}
        canOpen
        slicerOption={orca}
        slicerOptions={[orca]}
        onOpened={() => undefined}
        normalizedFor={() => target}
        normalizedStateOf={() => state}
        onOpenNormalized={async () => false}
        downloading={false}
        onDownload={() => undefined}
        zipCount={1}
        onDownloadZip={() => undefined}
      />
    </I18nextProvider>,
  );
}

describe("OpenInSlicerButton normalized entry", () => {
  it("offers to open the normalized copy before it is prepared", () => {
    expect(render("idle")).toContain("Open normalized in Snapmaker Orca");
  });

  it("says it is preparing while the copy is made", () => {
    expect(render("preparing")).toContain("Preparing normalized file…");
  });

  it("asks for the second click once a slow copy is ready", () => {
    const html = render("ready");
    expect(html).toContain("Ready – click to open in Snapmaker Orca");
    expect(html).not.toContain("Open normalized in Snapmaker Orca");
  });
});
