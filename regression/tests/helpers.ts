import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import { ADMIN_STATE } from "../playwright.config";

export const ADMIN = {
  displayName: "Regression Admin",
  email: "admin@regression.test",
  password: "regression-password",
};

export const CUBE_STL = path.join(__dirname, "..", "fixtures", "cube.stl");

/** The UI keeps the session token in localStorage (frontend/src/utils/auth.ts); API calls reuse it. */
export async function authToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem("thingport_auth_token"));
  if (!token) throw new Error("No auth token in localStorage");
  return token;
}

/** A 401 here is nearly always the one cause, and it surfaces in a spec far from the one that caused it. */
function why(status: number): string {
  return status === 401
    ? ". The shared admin session is gone: a test that signs out, changes the password or deletes the account" +
        " needs its own storage state, or it revokes the token every later spec replays (see DEVELOPMENT.md)."
    : "";
}

export async function apiGet(request: APIRequestContext, token: string, url: string) {
  const res = await request.get(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok()) throw new Error(`GET ${url} -> ${res.status()}${why(res.status())}`);
  return res.json();
}

export async function uploadCube(page: Page) {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Upload files" }).click();
  await (await chooser).setFiles(CUBE_STL);
  // A single upload opens the new model straight in its edit dialog.
  await page.waitForURL(/\/models\/[^/?]+\?edit=/);
  return page.url().match(/\/models\/([^/?]+)/)![1];
}

type FilePayload = { name: string; mimeType: string; buffer: Buffer };

/** Add -> Upload files, with files from disk or built in memory. */
export async function pickFiles(page: Page, files: string | string[] | FilePayload | FilePayload[]) {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Upload files" }).click();
  await (await chooser).setFiles(files);
}

/** Add -> Upload folder; the browser sends each file with its path under `dir`'s own name. */
export async function pickFolder(page: Page, dir: string) {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Upload folder" }).click();
  await (await chooser).setFiles(dir);
}

export type Plate = { id: string; filename: string; position: number; size: number; thumb_url: string | null };
export type Print = {
  id: string;
  name: string;
  title: string | null;
  category_id: string | null;
  plates: Plate[];
  preview_images: { id: string; position: number }[];
  supporting_file_count: number;
  thumb_url: string | null;
};
export type Category = { id: string; name: string; parent_id: string | null; kind: "category" | "folder" };
export type Summary = { model_count: number; category_count: number; collection_count: number };
export type ConsumeSettings = { available: boolean; path: string; mode: "separate" | "folder"; user_id: string | null };
export type Notification = { title: string; body: string | null; internal_path: string | null; read: boolean };

/** API access as the admin, for checking what an upload or import really stored. */
export class Api {
  constructor(
    private request: APIRequestContext,
    private token: string,
  ) {}

  /** The same checks as another account, e.g. one registered by a test. */
  as(token: string) {
    return new Api(this.request, token);
  }

  private async get<T>(url: string): Promise<T> {
    const res = await this.request.get(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok()) throw new Error(`GET ${url} -> ${res.status()}${why(res.status())}`);
    return res.json();
  }

  /** The only write: test setup that isn't itself under test. */
  async setConsume(patch: { mode?: ConsumeSettings["mode"]; user_id?: string }) {
    const res = await this.request.patch("/api/settings/consume", {
      headers: { Authorization: `Bearer ${this.token}` },
      data: patch,
    });
    if (!res.ok()) throw new Error(`PATCH /api/settings/consume -> ${res.status()}${why(res.status())}`);
    return (await res.json()) as ConsumeSettings;
  }

  consume = () => this.get<ConsumeSettings>("/api/settings/consume");
  notifications = () => this.get<{ items: Notification[] }>("/api/notifications").then((r) => r.items);
  summary = () => this.get<Summary>("/api/dashboard/summary");
  prints = () => this.get<Print[]>("/api/prints");
  print = (id: string) => this.get<Print>(`/api/print/${id}`);
  files = (id: string) => this.get<{ filename: string }[]>(`/api/print/${id}/files`);
  categories = () => this.get<Category[]>("/api/categories");

  /** Display name the UI shows: the title, else the name. */
  async printsNamed(...names: string[]) {
    const all = await this.prints();
    return names.map((n) => {
      const hits = all.filter((p) => (p.title || p.name) === n);
      if (hits.length !== 1) throw new Error(`Expected one model named "${n}", found ${hits.length}`);
      return hits[0];
    });
  }

  /** The folder at `segments` (top level first), or undefined. */
  async folderAt(...segments: string[]) {
    const all = await this.categories();
    let parent: string | null = null;
    let found: Category | undefined;
    for (const name of segments) {
      found = all.filter((c) => (c.parent_id ?? null) === parent && c.name === name).at(0);
      if (!found) return undefined;
      parent = found.id;
    }
    return found;
  }
}

function adminToken(): string {
  const state = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ADMIN_STATE), "utf8"));
  const entry = state.origins
    .flatMap((o: { localStorage: { name: string; value: string }[] }) => o.localStorage)
    .find((e: { name: string }) => e.name === "thingport_auth_token");
  if (!entry) throw new Error(`No auth token in ${ADMIN_STATE}`);
  return entry.value;
}

/**
 * `api` checks results as the admin. `alerts` collects window.alert() messages (how uploads report
 * failures); a test that expects one empties the array, otherwise any alert fails it.
 */
export const test = base.extend<{ api: Api; alerts: string[] }>({
  api: async ({ request }, use) => {
    await use(new Api(request, adminToken()));
  },
  alerts: [
    async ({ page }, use) => {
      const alerts: string[] = [];
      page.on("dialog", (dialog) => {
        alerts.push(dialog.message());
        void dialog.dismiss();
      });
      await use(alerts);
      expect(alerts, "unexpected alert()").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Waits for the "Uploaded N models" toast, the signal a multi-model upload has finished. */
export async function expectUploaded(page: Page, count: number) {
  await expect(page.getByText(`Uploaded ${count} models`)).toBeVisible({ timeout: 30_000 });
}
