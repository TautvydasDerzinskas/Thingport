import type { Locator, Page } from "@playwright/test";
import { file, png, stl, text, threeMf, zip } from "./fixtures";
import { expect, expectUploaded, pickFiles, test } from "./helpers";

const zipFile = (name: string, entries: Record<string, Uint8Array>) => file(name, zip(entries), "application/zip");

function zipDialog(page: Page) {
  return page.getByRole("dialog", { name: /Import zip|Choose files/ });
}

/** Import and unzip, then confirm the listed entries. */
async function unzip(page: Page, entries: string[]) {
  const dialog = zipDialog(page);
  await dialog.getByRole("button", { name: "Import and unzip" }).click();
  await expect(dialog.getByText("Choose files", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("checkbox")).toHaveCount(entries.length);
  for (const entry of entries)
    await expect(dialog.getByRole("checkbox", { name: new RegExp(`^${entry}`) })).toBeChecked();
  await expect(dialog).toContainText(`${entries.length} of ${entries.length} selected`);
  return dialog;
}

/** Under the list: how the ticked files become models. */
function importAs(dialog: Locator, label: string) {
  return dialog.getByRole("group", { name: "Import as" }).getByRole("button", { name: label, exact: true });
}

const pdf = () => text("%PDF-1.4 not really");

test("import as zip keeps the archive whole, as one model", async ({ page, api }) => {
  const before = await api.summary();
  await page.goto("/models");
  await pickFiles(page, zipFile("Zip Whole Kit.zip", { "a.stl": stl(), "Parts/b.3mf": threeMf() }));

  const dialog = zipDialog(page);
  await expect(dialog).toContainText("How would you like to handle this zip file?");
  await expect(dialog).toContainText("Zip Whole Kit.zip");
  await dialog.getByRole("button", { name: "Import as zip" }).click();

  await page.waitForURL(/\/models\/[^/?]+\?edit=/);
  const print = await api.print(page.url().match(/\/models\/([^/?]+)/)![1]);
  expect(print).toMatchObject({ name: "Zip Whole Kit", category_id: null });
  expect(print.plates.map((p) => p.filename)).toEqual(["Zip Whole Kit.zip"]);
  const after = await api.summary();
  expect(after.model_count).toBe(before.model_count + 1);
  expect(after.category_count).toBe(before.category_count);
});

test("import and unzip makes one model by default: its files in their folders, pictures as photos", async ({
  page,
  api,
}) => {
  const before = await api.summary();
  await page.goto("/models");
  await pickFiles(
    page,
    zipFile("Zip Frog Kit.zip", {
      "Frog/frog body.stl": stl(),
      "Frog/Parts/frog legs.3mf": threeMf(),
      "Frog/photo.png": png(),
      "Frog/docs/Assembly guide.pdf": pdf(),
      "Frog/Print settings.txt": text("0.2 mm layers"),
    }),
  );

  const dialog = await unzip(page, [
    "Frog/docs/Assembly guide.pdf",
    "Frog/frog body.stl",
    "Frog/Parts/frog legs.3mf",
    "Frog/photo.png",
    "Frog/Print settings.txt",
  ]);
  await expect(importAs(dialog, "One model")).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Import selected" }).click();
  // One model, so it opens for editing like a single upload.
  await page.waitForURL(/\/models\/[^/?]+\?edit=/);

  const print = await api.print(page.url().match(/\/models\/([^/?]+)/)![1]);
  // Named after the zip; the one folder everything shares isn't kept.
  expect(print).toMatchObject({ title: "Zip Frog Kit", category_id: null });
  expect(print.plates.map((p) => [p.folder, p.filename])).toEqual([
    [null, "frog body.stl"],
    ["Parts", "frog legs.3mf"],
  ]);
  expect(print.preview_images.filter((p) => !p.generated)).toHaveLength(1);
  const files = (await api.files(print.id)).toSorted((a, b) => a.filename.localeCompare(b.filename));
  expect(files.map((f) => [f.folder, f.filename])).toEqual([
    ["docs", "Assembly guide.pdf"],
    [null, "Print settings.txt"],
  ]);

  const after = await api.summary();
  expect(after.model_count).toBe(before.model_count + 1);
  expect(after.category_count).toBe(before.category_count);
});

test("import and unzip, a model per folder: each folder with model files is a model, with its documents and pictures", async ({
  page,
  api,
}) => {
  const before = await api.summary();
  await page.goto("/models");
  await pickFiles(
    page,
    zipFile("Zip Shelf.zip", {
      "Zip Owl/owl.stl": stl(),
      "Zip Owl/docs/owl guide.pdf": pdf(),
      "Zip Owl/pics/owl.png": png(),
      "Zip Cat/cat.3mf": threeMf(),
      "Zip Cat/cat notes.txt": text("print upright"),
    }),
  );

  const dialog = await unzip(page, [
    "Zip Cat/cat notes.txt",
    "Zip Cat/cat.3mf",
    "Zip Owl/docs/owl guide.pdf",
    "Zip Owl/owl.stl",
    "Zip Owl/pics/owl.png",
  ]);
  await importAs(dialog, "A model per folder").click();
  await dialog.getByRole("button", { name: "Import selected" }).click();
  await expectUploaded(page, 2);

  const [owl, cat] = await api.printsNamed("Zip Owl", "Zip Cat");
  expect(owl.plates.map((p) => p.filename)).toEqual(["owl.stl"]);
  expect(owl.preview_images.filter((p) => !p.generated)).toHaveLength(1);
  expect((await api.files(owl.id)).map((f) => [f.folder, f.filename])).toEqual([["docs", "owl guide.pdf"]]);
  expect(cat.plates.map((p) => p.filename)).toEqual(["cat.3mf"]);
  expect((await api.files(cat.id)).map((f) => [f.folder, f.filename])).toEqual([[null, "cat notes.txt"]]);
  expect([owl.category_id, cat.category_id]).toEqual([null, null]);

  const after = await api.summary();
  expect(after.model_count).toBe(before.model_count + 2);
  expect(after.category_count).toBe(before.category_count);
});

test("import and unzip, a model per file: a folder per directory, however deep", async ({ page, api }) => {
  const before = await api.summary();
  await page.goto("/models");
  await pickFiles(
    page,
    zipFile("Zip Library.zip", {
      "Zip Loose.stl": stl(),
      "Zip Pack/Zip Gear.3mf": threeMf(),
      "Zip Pack/Zip Render.png": png(),
      "Zip Pack/readme.txt": text("not a model"),
      "Zip Pack/Zip Deep/Zip Deeper/Zip Bolt.stl": stl(),
    }),
  );

  const dialog = await unzip(page, [
    "Zip Loose.stl",
    "Zip Pack/readme.txt",
    "Zip Pack/Zip Deep/Zip Deeper/Zip Bolt.stl",
    "Zip Pack/Zip Gear.3mf",
    "Zip Pack/Zip Render.png",
  ]);
  await importAs(dialog, "A model per file").click();
  await dialog.getByRole("button", { name: "Import selected" }).click();
  // The text file is listed but can't be a model on its own, so four, not five, and it's said which.
  await expectUploaded(page, 4);
  await expect(page.getByText(/readme\.txt wasn't added/)).toBeVisible();
  await expect(dialog).toBeHidden();

  const pack = await api.folderAt("Zip Pack");
  const deeper = await api.folderAt("Zip Pack", "Zip Deep", "Zip Deeper");
  expect(pack?.kind).toBe("folder");
  expect(deeper?.kind).toBe("folder");
  const [loose, gear, render, bolt] = await api.printsNamed("Zip Loose", "Zip Gear", "Zip Render", "Zip Bolt");
  expect(loose.category_id).toBeNull();
  expect(gear.category_id).toBe(pack!.id);
  expect(render.category_id).toBe(pack!.id);
  expect(bolt.category_id).toBe(deeper!.id);
  expect(gear.plates[0].thumb_url).toBeTruthy();
  expect(render.plates[0].thumb_url).toBeTruthy();

  const after = await api.summary();
  expect(after.model_count).toBe(before.model_count + 4);
  expect(after.category_count).toBe(before.category_count + 3);
});

test("only the ticked entries are unzipped", async ({ page, api }) => {
  await page.goto("/models");
  await pickFiles(
    page,
    zipFile("Zip Partial.zip", { "Pick One.stl": stl(), "Pick Two.3mf": threeMf(), "Skip Me.stl": stl() }),
  );
  const dialog = await unzip(page, ["Pick One.stl", "Pick Two.3mf", "Skip Me.stl"]);

  await dialog.getByRole("button", { name: "Clear" }).click();
  await expect(dialog).toContainText("0 of 3 selected");
  await expect(dialog.getByRole("button", { name: "Import selected" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Select all" }).click();
  await expect(dialog).toContainText("3 of 3 selected");
  await dialog.getByRole("checkbox", { name: /^Skip Me\.stl/ }).uncheck();
  await expect(dialog).toContainText("2 of 3 selected");
  // No folders in this zip, so no model per folder to offer.
  await expect(importAs(dialog, "A model per folder")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Import selected" }).click();
  await page.waitForURL(/\/models\/[^/?]+\?edit=/);

  const [partial] = await api.printsNamed("Zip Partial");
  expect(partial.plates.map((p) => p.filename)).toEqual(["Pick One.stl", "Pick Two.3mf"]);
  expect((await api.prints()).some((p) => p.name === "Skip Me")).toBe(false);
});

test("a zip picked together with other files: the files upload, then the zip asks", async ({ page, api }) => {
  const before = await api.summary();
  await page.goto("/models");
  await pickFiles(page, [
    file("Mixed Plain.stl", stl()),
    zipFile("Mixed Bundle.zip", { "Mixed Inner A.stl": stl(), "Mixed Inner B.3mf": threeMf() }),
  ]);
  const dialog = await unzip(page, ["Mixed Inner A.stl", "Mixed Inner B.3mf"]);
  await dialog.getByRole("button", { name: "Import selected" }).click();
  await expectUploaded(page, 2);

  const [, bundle] = await api.printsNamed("Mixed Plain", "Mixed Bundle");
  expect(bundle.plates.map((p) => p.filename)).toEqual(["Mixed Inner A.stl", "Mixed Inner B.3mf"]);
  expect((await api.summary()).model_count).toBe(before.model_count + 2);
});

test("several zips are asked about one after another", async ({ page, api }) => {
  await page.goto("/models");
  await pickFiles(page, [
    zipFile("Queue First.zip", { "Queue One.stl": stl() }),
    zipFile("Queue Second.zip", { "Queue Two.stl": stl() }),
  ]);

  const dialog = zipDialog(page);
  await expect(dialog).toContainText("Queue First.zip");
  await dialog.getByRole("button", { name: "Import as zip" }).click();
  await expect(dialog).toContainText("Queue Second.zip");
  await (await unzip(page, ["Queue Two.stl"])).getByRole("button", { name: "Import selected" }).click();
  await expectUploaded(page, 2);

  // Unzipped as one model, named after its zip.
  await api.printsNamed("Queue First", "Queue Second");
});

test("cancelling the zip choice uploads nothing", async ({ page, api }) => {
  const before = await api.summary();
  await page.goto("/models");
  await pickFiles(page, zipFile("Zip Cancelled.zip", { "Never.stl": stl() }));
  const dialog = await unzip(page, ["Never.stl"]);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
  expect((await api.summary()).model_count).toBe(before.model_count);
});

test("an unreadable zip says so instead of importing", async ({ page, api }) => {
  const before = await api.summary();
  await page.goto("/models");
  await pickFiles(page, file("Zip Broken.zip", text("this is not a zip archive"), "application/zip"));
  const dialog = zipDialog(page);
  await dialog.getByRole("button", { name: "Import and unzip" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  // Still on the first step, free to import it whole or close.
  await expect(dialog.getByRole("button", { name: "Import as zip" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Close" }).click();
  expect((await api.summary()).model_count).toBe(before.model_count);
});

test("macOS archive junk is neither listed nor imported", async ({ page, api }) => {
  const before = await api.summary();
  await page.goto("/models");
  await pickFiles(
    page,
    zipFile("Zip Mac.zip", {
      "Zip Mac/Mac Part.stl": stl(),
      "Zip Mac/.DS_Store": text("junk"),
      "__MACOSX/Zip Mac/._Mac Part.stl": text("resource fork"),
    }),
  );
  const dialog = await unzip(page, ["Zip Mac/Mac Part.stl"]);
  await dialog.getByRole("button", { name: "Import selected" }).click();
  // Just the one model, which opens for editing.
  await page.waitForURL(/\/models\/[^/?]+\?edit=/);

  const [mac] = await api.printsNamed("Zip Mac");
  expect(mac.plates.map((p) => [p.folder, p.filename])).toEqual([[null, "Mac Part.stl"]]);
  expect((await api.summary()).model_count).toBe(before.model_count + 1);
  expect(await api.folderAt("__MACOSX")).toBeUndefined();
});
