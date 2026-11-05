import { describe, expect, it, vi } from "vitest";
import { renderQueue, textOf } from "../../importQueue/testing";
import { ZipImportModal } from "./index";

// The real one renders into a portal, which needs a DOM.
vi.mock("@mui/material/Dialog", () => ({
  default: ({ children }: { children: React.ReactNode }) => <dialog open>{children}</dialog>,
}));

const noop = () => undefined;

const choice = (busy: boolean, reading: boolean) =>
  renderQueue(
    <ZipImportModal
      label="pack.zip"
      stage="choice"
      entries={[]}
      selected={new Set()}
      selectedCount={0}
      allSelected={false}
      busy={busy}
      reading={reading}
      error={null}
      onClose={noop}
      onImportAsZip={noop}
      onLoadEntries={noop}
      onImportSelected={noop}
      onToggleEntry={noop}
      onSelectAll={noop}
      onClearAll={noop}
    />,
  );

describe("the zip prompt's choice", () => {
  it("offers both ways in, with nothing going on", () => {
    const html = choice(false, false);
    expect(textOf(html)).toContain("Import and unzip");
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toMatch(/<button[^>]*disabled/);
  });

  it("shows it's reading the zip on the button, which can't be pressed again meanwhile", () => {
    const html = choice(true, true);
    expect(textOf(html)).toContain("Reading zip…");
    expect(textOf(html)).not.toContain("Import and unzip");
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-busy="true"[^>]*>(?:(?!<\/button>).)*role="progressbar"/s);
  });

  it("only turns it off while the zip goes in as it is, with no word of reading it", () => {
    const html = choice(true, false);
    expect(textOf(html)).toContain("Import and unzip");
    expect(html).not.toContain('role="progressbar"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Import and unzip/s);
  });
});
