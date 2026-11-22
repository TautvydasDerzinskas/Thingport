import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdaptedTarget } from "./useOpenInSlicer";

// The hook's state as a mounted component keeps it, without a DOM: each useState and useRef is a cell kept between
// renders, an effect runs once, on the first, and `unmount()` runs what it returned.
const cells: unknown[] = [];
const cleanups: (() => void)[] = [];
let cursor = 0;
vi.mock("react", () => ({
  useState: <T>(initial: T) => {
    const index = cursor++;
    if (!(index in cells)) cells[index] = initial;
    return [cells[index], (next: T) => (cells[index] = next)];
  },
  useRef: <T>(initial: T) => {
    const index = cursor++;
    if (!(index in cells)) cells[index] = { current: initial };
    return cells[index];
  },
  useEffect: (effect: () => (() => void) | void) => {
    const index = cursor++;
    if (index in cells) return;
    cells[index] = true;
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  },
  useCallback: <T>(callback: T) => callback,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../components/ToastProvider", () => ({ useToast: () => () => undefined }));
vi.mock("../../components/printers/PrinterAskDialog", () => ({ default: () => null }));
vi.mock("../../hooks/useUserPrinters", () => ({ useUserPrinters: () => ({ printers: [] }) }));
vi.mock("../../hooks/useSlicerPreference", () => ({ setCachedSlicerSettings: () => undefined }));
vi.mock("../../api/settings", () => ({ settingsApi: {} }));

const adaptPlate = vi.fn<() => Promise<{ status: string }>>();
vi.mock("../../api/prints", () => ({ printsApi: { adaptPlate: () => adaptPlate(), fileUrl: (url: string) => url } }));
const saveBlobToDisk = vi.fn<(blob: Blob, filename: string) => Promise<void>>(async () => undefined);
vi.mock("../../utils/downloadResponse", () => ({
  saveBlobToDisk: (blob: Blob, filename: string) => saveBlobToDisk(blob, filename),
}));

const target: AdaptedTarget = {
  caps: { preview3d: true, openInSlicer: true, openInStudio: true, customize: false },
  key: "plate-1",
  url: "/plate-1.3mf",
  filename: "benchy.3mf",
  launchFilename: "benchy.3mf",
  index: 0,
  plate: {
    id: "plate-1",
    print_id: "print-1",
    position: 0,
    filename: "benchy.3mf",
    mime: "model/3mf",
    size: 3,
    url: "/plate-1.3mf",
  },
  href: "bambustudio://open?file=x",
  plan: { output: "bambu", tag: null, dropOrcaTag: false, dialect: null },
  printer: null,
  fileUrl: "/plate-1-adapted.3mf",
};

function pending<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

/** The hook in a component mounted afresh: `render()` is what it gets each time it renders. */
async function mount(onDownloaded: () => void) {
  vi.resetModules();
  cells.length = 0;
  cleanups.length = 0;
  const { useAdaptedOpen } = await import("./useAdaptedOpen");
  const render = () => {
    cursor = 0;
    return useAdaptedOpen("print-1", "bambustudio", () => undefined, undefined, onDownloaded);
  };
  return { render, unmount: () => cleanups.forEach((cleanup) => cleanup()) };
}

const blobFetch = (blob: Promise<Blob>) =>
  vi.fn<() => Promise<Pick<Response, "status" | "ok" | "blob">>>(async () => ({
    status: 200,
    ok: true,
    blob: () => blob,
  }));

afterEach(() => {
  adaptPlate.mockReset();
  saveBlobToDisk.mockClear();
  vi.unstubAllGlobals();
});

describe("downloading an adapted copy", () => {
  it("saves the copy once it's made, named for it", async () => {
    const onDownloaded = vi.fn<() => void>();
    const { render } = await mount(onDownloaded);
    adaptPlate.mockResolvedValue({ status: "ready" });
    vi.stubGlobal("fetch", blobFetch(Promise.resolve(new Blob(["3mf"]))));
    expect(await render().download(target)).toBe(true);
    expect(saveBlobToDisk).toHaveBeenCalledWith(expect.any(Blob), "benchy-adapted.3mf");
    expect(onDownloaded).toHaveBeenCalledOnce();
  });

  it("fetches nothing once the page is left while a cached copy is asked for", async () => {
    const onDownloaded = vi.fn<() => void>();
    const { render, unmount } = await mount(onDownloaded);
    const answer = pending<{ status: string }>();
    adaptPlate.mockReturnValue(answer.promise);
    const fetch = blobFetch(Promise.resolve(new Blob(["3mf"])));
    vi.stubGlobal("fetch", fetch);
    const saved = render().download(target);
    unmount();
    answer.resolve({ status: "ready" });
    expect(await saved).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(saveBlobToDisk).not.toHaveBeenCalled();
    expect(onDownloaded).not.toHaveBeenCalled();
  });

  it("saves nothing once the page is left while the file comes", async () => {
    const onDownloaded = vi.fn<() => void>();
    const { render, unmount } = await mount(onDownloaded);
    adaptPlate.mockResolvedValue({ status: "ready" });
    const blob = pending<Blob>();
    const fetch = blobFetch(blob.promise);
    vi.stubGlobal("fetch", fetch);
    const saved = render().download(target);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    unmount();
    blob.resolve(new Blob(["3mf"]));
    expect(await saved).toBe(false);
    expect(saveBlobToDisk).not.toHaveBeenCalled();
    expect(onDownloaded).not.toHaveBeenCalled();
  });
});
