import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { useUploadImport } from "./useUploadImport";

const jobs = vi.hoisted(() => ({
  inspectLink: vi.fn<() => Promise<{ is_zip: boolean; filename?: string }>>().mockResolvedValue({ is_zip: false }),
  startSingleImport: vi.fn<() => void>(),
  startLinksImport: vi.fn<() => void>(),
  zipPrompt: vi.fn<(config: { label: string }) => Promise<void>>(),
}));
vi.mock("../../api/imports", () => ({ importsApi: { inspectLink: jobs.inspectLink } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn<() => void>() }));
vi.mock("../Layout/NotificationsContext", () => ({ useNotifications: () => ({ refresh: vi.fn<() => void>() }) }));
vi.mock("../ToastProvider", () => ({ useToast: () => vi.fn<() => void>() }));
vi.mock("../Layout/ImportJobContext", () => ({ useImportJob: () => jobs }));
vi.mock("./ZipImportModal", () => ({
  useZipImportPrompt: () => ({ prompt: jobs.zipPrompt, isOpen: false, modal: null }),
}));
vi.mock("./CollectionImportModal", () => ({ useCollectionImportPrompt: () => ({}) }));
vi.mock("./ImportModeModal", () => ({ useImportModePrompt: () => ({}) }));

beforeEach(() => vi.clearAllMocks());

it("leaves saved credentials on the server for single and multi-link imports", async () => {
  let upload!: ReturnType<typeof useUploadImport>;
  function Harness() {
    // Simulate a caller retaining the old saved-cookie property across an upgrade.
    const props = { onUploaded: vi.fn<() => void>(), categoryId: "category", makerworldCookie: "saved-cookie" };
    // Capture the hook API for calls after the server render completes.
    // oxlint-disable-next-line react/globals
    upload = useUploadImport(props);
    return null;
  }
  renderToStaticMarkup(<Harness />);
  const url = "https://makerworld.com/en/models/12345";
  await upload.submitImport(url);
  expect(jobs.startSingleImport).toHaveBeenCalledWith({ url, category_id: "category" });
  await upload.submitImportMany([url]);
  expect(jobs.startLinksImport).toHaveBeenCalledWith({ urls: [url], scope: "url", category_id: "category" });
});

it("shows ZIP choices one at a time when two inspections finish together", async () => {
  const inspections = [0, 1].map(() => {
    let resolve!: (value: { is_zip: boolean; filename: string }) => void;
    const promise = new Promise<{ is_zip: boolean; filename: string }>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  });
  jobs.inspectLink
    .mockImplementationOnce(() => inspections[0].promise)
    .mockImplementationOnce(() => inspections[1].promise);
  const closePrompts: Array<() => void> = [];
  jobs.zipPrompt.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        closePrompts.push(resolve);
      }),
  );
  let upload!: ReturnType<typeof useUploadImport>;
  function Harness() {
    // Capture the hook API for calls after the server render completes.
    // oxlint-disable-next-line react/globals
    upload = useUploadImport({ onUploaded: vi.fn<() => void>() });
    return null;
  }
  renderToStaticMarkup(<Harness />);
  const first = upload.submitImport("https://makerworld.com/en/models/12345");
  const second = upload.submitImport("https://makerworld.com/en/models/67890");
  inspections[0].resolve({ is_zip: true, filename: "first.zip" });
  inspections[1].resolve({ is_zip: true, filename: "second.zip" });
  await vi.waitFor(() => expect(jobs.zipPrompt).toHaveBeenCalledTimes(1));
  expect(jobs.zipPrompt.mock.calls[0][0]).toMatchObject({ label: "first.zip" });
  closePrompts[0]();
  await vi.waitFor(() => expect(jobs.zipPrompt).toHaveBeenCalledTimes(2));
  expect(jobs.zipPrompt.mock.calls[1][0]).toMatchObject({ label: "second.zip" });
  closePrompts[1]();
  await Promise.all([first, second]);
});
