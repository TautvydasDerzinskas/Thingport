import type { Locator, Page } from "@playwright/test";
import { type Api, expect, test } from "./helpers";

// A link straight to a zip (fixtures/kit.zip, from the fake provider): Kit/A holds a model file and a document in
// docs/, Kit/B a model file. It asks how its files become models, as an uploaded zip does.
const KIT = "https://files.regression.test/kit.zip";

const addButton = (page: Page) => page.getByRole("button", { name: "Add", exact: true });
const addHub = (page: Page) => page.getByRole("dialog", { name: "Add", exact: true });
const importAs = (dialog: Locator, label: string) =>
  dialog.getByRole("group", { name: "Import as" }).getByRole("button", { name: label, exact: true });

/** Add -> Import the link, then Import and unzip: the zip's list of files, with its choice. */
async function unzipKit(page: Page) {
  await page.goto("/models");
  await addButton(page).click();
  await addHub(page).getByRole("button", { name: "Import", exact: true }).click();
  const link = page.getByRole("dialog", { name: "Import from link" });
  await link.getByPlaceholder(/^Paste model links/).fill(KIT);
  await link.getByRole("button", { name: "Import", exact: true }).click();
  const zip = page.getByRole("dialog").filter({ hasText: "kit.zip" });
  await zip.getByRole("button", { name: "Import and unzip" }).click();
  await expect(importAs(zip, "One model")).toBeVisible();
  return zip;
}

/** A model's supporting files, once its import has saved them: it shows in the library a moment before. */
const filesOf = async (api: Api, id: string) => {
  let files: [string | null, string][] = [];
  await expect
    .poll(async () => (files = (await api.files(id)).map((f) => [f.folder, f.filename])), { timeout: 30_000 })
    .not.toEqual([]);
  return files;
};

/** Waits for the zip's job, which runs in the import line, to have made the models. */
async function modelsNamed(api: Api, ...names: string[]) {
  await expect
    .poll(async () => (await api.prints()).filter((p) => names.includes(p.title || p.name)).length, {
      timeout: 60_000,
    })
    .toBe(names.length);
  return api.printsNamed(...names);
}

test("a link to a zip makes one model of what's picked, its document beside the model files", async ({ page, api }) => {
  const zip = await unzipKit(page);
  // A ticked model file is in a folder, so a model per folder is offered too.
  await expect(importAs(zip, "A model per folder")).toBeVisible();
  await expect(importAs(zip, "One model")).toHaveAttribute("aria-pressed", "true");
  await zip.getByRole("button", { name: "Import selected" }).click();
  await expect(zip).toBeHidden();

  const [kit] = await modelsNamed(api, "kit");
  // Listed as soon as it's made, a moment before its plates are.
  await expect
    .poll(async () => (await api.print(kit.id)).plates.map((p) => [p.folder ?? null, p.filename]), { timeout: 30_000 })
    .toEqual([
      ["A", "a.stl"],
      ["B", "b.stl"],
    ]);
  expect(await filesOf(api, kit.id)).toEqual([["A/docs", "guide.pdf"]]);
});

test("a link to a zip, a model per folder: each folder with model files a model, its document with it", async ({
  page,
  api,
}) => {
  const zip = await unzipKit(page);
  await importAs(zip, "A model per folder").click();
  await zip.getByRole("button", { name: "Import selected" }).click();
  await expect(zip).toBeHidden();

  const [a, b] = await modelsNamed(api, "A", "B");
  expect(await filesOf(api, a.id)).toEqual([["docs", "guide.pdf"]]);
  expect(await api.files(b.id)).toEqual([]);
});
