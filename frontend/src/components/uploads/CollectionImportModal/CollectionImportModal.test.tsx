import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderQueue, textOf } from "../../importQueue/testing";
import { CollectionImportModalView } from "./index";

type Dismiss = (event: unknown, reason: "backdropClick" | "escapeKeyDown") => void;

const holder = vi.hoisted(() => ({ onClose: undefined as unknown }));

// The real one renders into a portal, which needs a DOM.
vi.mock("@mui/material/Dialog", () => ({
  default: ({ open, children, onClose }: { open: boolean; children: React.ReactNode; onClose?: unknown }) => {
    if (!open) return null;
    holder.onClose = onClose;
    return <dialog open>{children}</dialog>;
  },
}));

const noop = () => undefined;

function modal(stage: "loading" | "select" | "error", busy = false) {
  const onClose = vi.fn<() => void>();
  const html = renderQueue(
    <CollectionImportModalView
      label="https://example.com/list"
      stage={stage}
      collectionTitle={null}
      total={0}
      truncated={false}
      entries={[]}
      selected={new Set()}
      selectedCount={0}
      allSelected={false}
      busy={busy}
      error={null}
      onClose={onClose}
      onImportSelected={noop}
      onToggleEntry={noop}
      onSelectAll={noop}
      onClearAll={noop}
    />,
  );
  return { html, onClose, dismiss: holder.onClose as Dismiss | undefined };
}

beforeEach(() => {
  holder.onClose = undefined;
});

describe("the list picker", () => {
  it("stays through a click outside while it's loading, which can be the end of a double click", () => {
    const { dismiss, onClose } = modal("loading");
    dismiss?.({}, "backdropClick");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still goes on Escape while it's loading, and its close button is there too", () => {
    const { dismiss, onClose, html } = modal("loading");
    dismiss?.({}, "escapeKeyDown");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(html).toContain('aria-label="Close"');
    expect(textOf(html)).toContain("https://example.com/list");
  });

  it.each(["select", "error"] as const)("goes on a click outside once it's at %s", (stage) => {
    const { dismiss, onClose } = modal(stage);
    dismiss?.({}, "backdropClick");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("can't be dismissed at all while it's importing", () => {
    expect(modal("select", true).dismiss).toBeUndefined();
  });
});
