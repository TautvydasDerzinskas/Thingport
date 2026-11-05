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

  it("shows a model the provider keeps from the user as not pickable, with the provider's reason", () => {
    const html = renderQueue(
      <CollectionImportModalView
        label="https://www.meshy.ai/collections/Figures-01a1ac94-ba41-7557-b54d-1e6ddfe02ec0"
        provider="meshy"
        stage="select"
        collectionTitle="Figures"
        total={2}
        truncated={false}
        entries={[
          { design_id: "a", title: "Boxer dog figure", cover: null, already_imported: false, blocked: "own" },
          { design_id: "b", title: "Sleepy fox", cover: null, already_imported: false },
        ]}
        selected={new Set(["b"])}
        selectedCount={1}
        allSelected
        busy={false}
        error={null}
        onClose={noop}
        onImportSelected={noop}
        onToggleEntry={noop}
        onSelectAll={noop}
        onClearAll={noop}
      />,
    );
    expect(textOf(html)).toContain("Needs a paid Meshy plan");
    expect(html).toContain('aria-label="Meshy keeps the models its AI agent made for paid plans, even yours."');
    const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toContain("disabled");
    expect(boxes[1]).not.toContain("disabled");
  });
});
