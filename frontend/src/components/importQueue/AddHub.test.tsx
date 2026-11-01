import { describe, expect, it, vi } from "vitest";
import { AddHubContent } from "./AddHub";
import type { ImportQueueValue } from "./ImportQueueContext";
import { indicatorState, type QueueJob } from "./queueView";
import { renderQueue, testJob, testQueue, textOf } from "./testing";

const holder = vi.hoisted(() => ({ queue: null as unknown }));

vi.mock("./ImportQueueContext", () => ({ useImportQueue: () => holder.queue }));

const COMET = "conic-gradient";

function render(
  jobs: QueueJob[],
  {
    canImport = true,
    busy = false,
    ...overrides
  }: Omit<Partial<ImportQueueValue>, "busy"> & { canImport?: boolean; busy?: boolean } = {},
) {
  holder.queue = testQueue({
    jobs,
    indicator: indicatorState(jobs, false),
    ...overrides,
  });
  const none = () => undefined;
  return renderQueue(
    <AddHubContent
      canImport={canImport}
      busy={busy}
      onImport={none}
      onUploadFiles={none}
      onUploadFolder={none}
      onClose={none}
    />,
  );
}

const importing = testJob({ id: "r", status: "RUNNING", total: 12, processed: 5, source_label: "Wall mounts" });
const failed = (fields: Partial<QueueJob> = {}) =>
  testJob({
    id: "f",
    status: "ERROR",
    attention: true,
    source_label: "Dragon",
    failure_reason: "No files.",
    can_retry: true,
    ...fields,
  });

describe("AddHubContent", () => {
  it("offers every way to add a model", () => {
    const text = textOf(render([]));
    for (const label of ["Import", "Upload files", "Upload folder"]) expect(text).toContain(label);
  });

  it("has nothing to import from with every provider off", () => {
    const text = textOf(render([], { canImport: false }));
    expect(text).not.toMatch(/^Import /);
    expect(text).toContain("Upload files");
  });

  it("while something is being added, says so and offers nothing new, though the queue stays there", () => {
    const html = render([importing], { busy: true });
    expect(textOf(html)).toContain("Finish what you're adding first");
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(3);
    expect(textOf(html)).toContain("Wall mounts");
  });

  it("counts each section, with a button for it", () => {
    const text = textOf(render([importing, failed()]));
    expect(text).toContain("1 Importing");
    expect(text).toContain("1 Attention");
    expect(text).toContain("0 Waiting");
    expect(text).toContain("0 Finished");
  });

  it("goes by the server's total for Finished, as the list stops at fifty", () => {
    expect(textOf(render([], { finishedTotal: 312 }))).toContain("312 Finished");
  });

  it("shows what's running with its ring, and how far it's got", () => {
    const html = render([importing]);
    expect(html).toContain(COMET);
    expect(textOf(html)).toContain("Wall mounts");
    expect(textOf(html)).toContain("Importing · 5 of 12");
  });

  it("shows why one needs attention, and a Retry when there's one to offer", () => {
    expect(textOf(render([failed()]))).toContain("No files.");
    expect(textOf(render([failed()]))).toContain("Retry");
    expect(textOf(render([failed({ can_retry: false })]))).not.toContain("Retry");
  });

  it("says so when nothing is importing", () => {
    expect(textOf(render([]))).toContain("Nothing importing");
  });

  it("has no queue part on a backend older than the queue", () => {
    const text = textOf(render([], { supported: false }));
    expect(text).toContain("Upload files");
    expect(text).not.toContain("Import queue");
    expect(text).not.toContain("Finished");
  });
});
