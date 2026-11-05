import { describe, expect, it, vi } from "vitest";
import QueueSettingsPopover from "./QueueSettingsPopover";
import { renderQueue, testQueue, textOf } from "./testing";

const holder = vi.hoisted(() => ({ queue: null as unknown }));

vi.mock("./ImportQueueContext", () => ({ useImportQueue: () => holder.queue }));

// A closed popover renders nothing without a DOM, and what's in it is the point here.
vi.mock("@mui/material/Popover", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function render(startGrabLinks: boolean) {
  holder.queue = testQueue({ startGrabLinks });
  return renderQueue(<QueueSettingsPopover />);
}

describe("QueueSettingsPopover", () => {
  it("names the cog, and says it's closed", () => {
    const html = render(false);
    expect(html).toContain('aria-label="Queue settings"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("is off by default, and says what that means", () => {
    const html = render(false);
    expect(html).toContain('role="switch"');
    expect(html).not.toContain('checked=""');
    expect(textOf(html)).toBe("Start links from Grab automatically New links stay on hold until you start them.");
  });

  it("says what on means", () => {
    const html = render(true);
    expect(html).toContain('checked=""');
    expect(textOf(html)).toBe("Start links from Grab automatically New links go straight into the line.");
  });

  it("names the switch by its words: the row is one label, so they toggle it too", () => {
    expect(render(false)).toMatch(/<label[^>]*>.*Start links from Grab automatically.*role="switch".*<\/label>/s);
  });
});
