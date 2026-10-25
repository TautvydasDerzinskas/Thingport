import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { useUploadImport } from "./useUploadImport";

const jobs = vi.hoisted(() => ({
  inspectLink: vi.fn<() => Promise<{ is_zip: boolean }>>().mockResolvedValue({ is_zip: false }),
  startSingleImport: vi.fn<() => void>(),
  startLinksImport: vi.fn<() => void>(),
}));
vi.mock("../../api/imports", () => ({ importsApi: { inspectLink: jobs.inspectLink } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn<() => void>() }));
vi.mock("../Layout/NotificationsContext", () => ({ useNotifications: () => ({ refresh: vi.fn<() => void>() }) }));
vi.mock("../ToastProvider", () => ({ useToast: () => vi.fn<() => void>() }));
vi.mock("../Layout/ImportJobContext", () => ({ useImportJob: () => jobs }));
vi.mock("./ZipImportModal", () => ({ useZipImportPrompt: () => ({}) }));
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
