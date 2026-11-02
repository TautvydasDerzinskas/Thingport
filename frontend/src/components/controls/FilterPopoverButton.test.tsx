import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import FilterPopoverButton from "./FilterPopoverButton";

// A closed popover renders nothing without a DOM, and what its paper is told to be is the point here.
vi.mock("@mui/material/Popover", () => ({
  default: ({ children, slotProps }: { children: React.ReactNode; slotProps: { paper: Record<string, string> } }) => (
    <div role={slotProps.paper.role} aria-label={slotProps.paper["aria-label"]}>
      {children}
    </div>
  ),
}));

describe("FilterPopoverButton", () => {
  it("opens a dialog named like its button", () => {
    const html = renderToStaticMarkup(
      <FilterPopoverButton label="Filters" active={0}>
        Inside
      </FilterPopoverButton>,
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('<div role="dialog" aria-label="Filters">Inside</div>');
  });
});
