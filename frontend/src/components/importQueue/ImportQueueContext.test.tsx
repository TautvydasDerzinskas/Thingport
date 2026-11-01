import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en.json";
import { ToastProvider } from "../ToastProvider";
import { ImportQueueProvider, useFinishedVersion, useImportQueue, type ImportQueueValue } from "./ImportQueueContext";

const i18n = i18next.createInstance();
await i18n.init({ lng: "en", defaultNS: "app", resources: { en: { app: en.app } } });

function Consumer({ onValue }: { onValue: (value: ImportQueueValue) => void }) {
  onValue(useImportQueue());
  return <span>consumer</span>;
}

/** Renders `Consumer` inside whatever `wrap` puts around it, and hands back what it read. */
function capture(wrap: (consumer: React.ReactNode) => React.ReactNode = (consumer) => consumer) {
  const values: ImportQueueValue[] = [];
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>{wrap(<Consumer onValue={(value) => values.push(value)} />)}</I18nextProvider>,
  );
  return { html, value: values[0] };
}

describe("useFinishedVersion", () => {
  function Version() {
    return <span>version {useFinishedVersion()}</span>;
  }

  it("stays still outside the provider, where the home page's dashboard sits", () => {
    expect(renderToStaticMarkup(<Version />)).toContain("version 0");
  });

  it("starts from nothing inside it", () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ToastProvider>
            <ImportQueueProvider viewerId="me" isAdmin={false}>
              <Version />
            </ImportQueueProvider>
          </ToastProvider>
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(html).toContain("version 0");
  });
});

describe("useImportQueue", () => {
  it("doesn't throw outside the provider, and has no queue to show there", () => {
    const { value } = capture();
    expect(value).toMatchObject({ supported: false, loading: false, jobs: [], finishedVersion: 0 });
    expect(value.indicator.kind).toBe("idle");
    expect(() => value.open("wait")).not.toThrow();
    expect(() => value.close()).not.toThrow();
  });

  it("can still submit outside the provider", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ job_id: "j", status: "QUEUED", position: 1 }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { value } = capture();
    await expect(value.submitLink({ url: "https://example.com/a" })).resolves.toMatchObject({ kind: "job" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/import?queue=1");
    vi.unstubAllGlobals();
  });
});

describe("ImportQueueProvider", () => {
  it("renders what's inside it, and hands it the viewer's queue", () => {
    const { html, value } = capture((consumer) => (
      <MemoryRouter>
        <ToastProvider>
          <ImportQueueProvider viewerId="me" isAdmin={false}>
            {consumer}
          </ImportQueueProvider>
        </ToastProvider>
      </MemoryRouter>
    ));
    expect(html).toContain("consumer");
    expect(value).toMatchObject({
      viewerId: "me",
      supported: true,
      loading: true,
      jobs: [],
      flash: false,
      dialog: { open: false, section: "run", scope: "mine", person: null },
    });
    expect(value.indicator.kind).toBe("idle");
    for (const action of ["open", "close", "startJob", "submitLink", "setStartGrabLinks"] as const) {
      expect(value[action]).toEqual(expect.any(Function));
    }
  });
});
