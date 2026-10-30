import path from "node:path";
import type { Page } from "@playwright/test";
import { png, stl, text, threeMf, writeTree, zip } from "./fixtures";
import { expect, expectUploaded, pickFolder, test } from "./helpers";

const EACH_FOLDER = /^Each folder is one model/;
const EACH_FILE = /^Each model file is a separate model/;

async function dashboardCount(page: Page, label: string) {
  await page.goto("/");
  const card = page
    .getByRole("main")
    .locator(".MuiPaper-root")
    .filter({ has: page.getByText(label, { exact: true }) });
  return Number(await card.getByRole("heading", { level: 3 }).textContent());
}

test("each folder becomes one model: model files as plates, images as previews, the rest attached", async ({
  page,
  api,
}, testInfo) => {
  const dir = writeTree(path.join(testInfo.outputPath(), "Fold Library"), {
    "Fold Robot/robot body.stl": stl(),
    "Fold Robot/robot arm.3mf": threeMf(),
    "Fold Robot/b-side.png": png([10, 200, 10]),
    "Fold Robot/a-front.png": png([200, 10, 10]),
    "Fold Robot/notes.txt": text("print at 0.2mm"),
    "Fold Robot/manual.pdf": text("%PDF-1.4 not really"),
    "Fold Robot/.DS_Store": text("junk"),
    "Fold Robot/Thumbs.db": text("junk"),
    "Fold Vase/vase.stl": stl(),
    "Sub/readme.txt": text("no model here"),
    "Sub/Deeper/Fold Lamp/lamp.3mf": threeMf(),
    "Sub/Deeper/Fold Lamp/cover.png": png(),
  });
  const modelsBefore = await dashboardCount(page, "Models");
  const foldersBefore = await dashboardCount(page, "Categories & folders");

  await pickFolder(page, dir);
  // System files are dropped before anything is counted.
  const mode = page.getByRole("dialog", { name: /Import folders \(10 files\)/ });
  await expect(mode).toContainText("Fold Library");
  await mode.getByRole("button", { name: EACH_FOLDER }).click();
  await expectUploaded(page, 3);

  // The picked folder and the folders above each model become folders; model folders don't.
  const library = await api.folderAt("Fold Library");
  const deeper = await api.folderAt("Fold Library", "Sub", "Deeper");
  expect(library?.kind).toBe("folder");
  expect(deeper?.kind).toBe("folder");
  expect(await api.folderAt("Fold Library", "Fold Robot")).toBeUndefined();

  const [robot, vase, lamp] = await api.printsNamed("Fold Robot", "Fold Vase", "Fold Lamp");
  expect(robot.title).toBe("Fold Robot");
  expect(robot.category_id).toBe(library!.id);
  expect(robot.plates.map((p) => p.filename)).toEqual(["robot arm.3mf", "robot body.stl"]);
  expect(robot.preview_images).toHaveLength(2);
  expect(robot.supporting_file_count).toBe(2);
  expect((await api.files(robot.id)).map((f) => f.filename).toSorted()).toEqual(["manual.pdf", "notes.txt"]);

  expect(vase.category_id).toBe(library!.id);
  expect(vase.plates.map((p) => p.filename)).toEqual(["vase.stl"]);
  // No image of its own; the preview the backend may already have rendered for it doesn't count.
  expect(vase.preview_images.filter((p) => !p.generated)).toEqual([]);

  expect(lamp.category_id).toBe(deeper!.id);
  expect(lamp.plates[0].thumb_url).toBeTruthy();
  expect(lamp.preview_images).toHaveLength(1);

  expect(await dashboardCount(page, "Models")).toBe(modelsBefore + 3);
  expect(await dashboardCount(page, "Categories & folders")).toBe(foldersBefore + 3);

  // The tree is browsable from the Models page.
  await page.goto("/models");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Folders", exact: true }).click();
  await expect(main.getByRole("heading", { name: "Folders", level: 6 })).toBeVisible();
  await main.getByRole("button", { name: "Fold Library", exact: true }).click();
  await expect(main.getByText("Fold Robot", { exact: true })).toBeVisible();
  await expect(main.getByText("Fold Vase", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Sub", exact: true }).click();
  await main.getByRole("button", { name: "Deeper", exact: true }).click();
  await expect(main.getByText("Fold Lamp", { exact: true })).toBeVisible();
});

test("each model file can be its own model, with every directory a folder", async ({ page, api }, testInfo) => {
  const dir = writeTree(path.join(testInfo.outputPath(), "Fold Each"), {
    "Parts/Each One.stl": stl(),
    "Parts/Each Two.3mf": threeMf(),
    "Parts/Each Pic.png": png(),
    "Parts/info.txt": text("skipped"),
    "Parts/Nested/Each Three.stl": stl(),
  });
  const before = await api.summary();

  await page.goto("/models");
  await pickFolder(page, dir);
  await page
    .getByRole("dialog", { name: /Import folders \(5 files\)/ })
    .getByRole("button", { name: EACH_FILE })
    .click();
  await expectUploaded(page, 4);

  const parts = await api.folderAt("Fold Each", "Parts");
  const nested = await api.folderAt("Fold Each", "Parts", "Nested");
  const [one, two, pic, three] = await api.printsNamed("Each One", "Each Two", "Each Pic", "Each Three");
  expect([one, two, pic].map((p) => p.category_id)).toEqual([parts!.id, parts!.id, parts!.id]);
  expect(three.category_id).toBe(nested!.id);
  for (const p of [one, two, pic, three]) expect(p.plates).toHaveLength(1);

  const after = await api.summary();
  expect(after.model_count).toBe(before.model_count + 4);
  expect(after.category_count).toBe(before.category_count + 3);
});

test("model files directly in the picked folder make that folder the model", async ({ page, api }, testInfo) => {
  const dir = writeTree(path.join(testInfo.outputPath(), "Fold Single"), {
    "top.stl": stl(),
    "bottom.3mf": threeMf(),
    "photo.png": png(),
  });
  const before = await api.summary();

  await page.goto("/models");
  await pickFolder(page, dir);
  await page
    .getByRole("dialog", { name: /Import folders \(3 files\)/ })
    .getByRole("button", { name: EACH_FOLDER })
    .click();
  await page.waitForURL(/\/models\/[^/?]+\?edit=/);

  const print = await api.print(page.url().match(/\/models\/([^/?]+)/)![1]);
  expect(print).toMatchObject({ title: "Fold Single", category_id: null });
  expect(print.plates.map((p) => p.filename)).toEqual(["bottom.3mf", "top.stl"]);
  expect(print.preview_images).toHaveLength(1);
  const after = await api.summary();
  expect(after.model_count).toBe(before.model_count + 1);
  expect(after.category_count).toBe(before.category_count);
});

test("uploading the same tree again reuses its folders", async ({ page, api }, testInfo) => {
  const dir = writeTree(path.join(testInfo.outputPath(), "Fold Again"), { "Again Thing/thing.stl": stl() });

  for (const round of [1, 2]) {
    await page.goto("/models");
    const before = await api.summary();
    await pickFolder(page, dir);
    await page
      .getByRole("dialog", { name: /Import folders/ })
      .getByRole("button", { name: EACH_FOLDER })
      .click();
    await page.waitForURL(/\/models\/[^/?]+\?edit=/);
    const after = await api.summary();
    expect(after.model_count).toBe(before.model_count + 1);
    expect(after.category_count).toBe(before.category_count + (round === 1 ? 1 : 0));
  }

  const folder = await api.folderAt("Fold Again");
  const copies = (await api.prints()).filter((p) => p.title === "Again Thing");
  expect(copies.map((p) => p.category_id)).toEqual([folder!.id, folder!.id]);
  // Same folder, so the second one gets a distinct name.
  expect(copies.map((p) => p.name).toSorted()).toEqual(["Again Thing", "Again Thing (2)"]);
});

test("a zip inside a folder unzips into that folder", async ({ page, api }, testInfo) => {
  const dir = writeTree(path.join(testInfo.outputPath(), "Fold Zipped"), {
    "Kit/kit base.stl": stl(),
    "Kit/parts.zip": zip({ "Zipped Gear.stl": stl(), "Pins/Zipped Pin.3mf": threeMf() }),
  });

  await page.goto("/models");
  await pickFolder(page, dir);
  // The zip isn't counted with the folder's files; it gets its own question afterwards.
  await page
    .getByRole("dialog", { name: /Import folders \(1 files\)/ })
    .getByRole("button", { name: EACH_FOLDER })
    .click();
  const zipDialog = page.getByRole("dialog", { name: /Import zip|Choose files/ });
  await expect(zipDialog).toContainText("parts.zip");
  await zipDialog.getByRole("button", { name: "Import and unzip" }).click();
  await zipDialog.getByRole("button", { name: "Import selected" }).click();
  await expectUploaded(page, 3);

  const zipped = await api.folderAt("Fold Zipped");
  const kit = await api.folderAt("Fold Zipped", "Kit");
  const pins = await api.folderAt("Fold Zipped", "Kit", "Pins");
  const [model, gear, pin] = await api.printsNamed("Kit", "Zipped Gear", "Zipped Pin");
  expect(model.category_id).toBe(zipped!.id);
  expect(model.plates.map((p) => p.filename)).toEqual(["kit base.stl"]);
  expect(gear.category_id).toBe(kit!.id);
  expect(pin.category_id).toBe(pins!.id);
});

test("a folder of only images uploads each image, without asking", async ({ page, api }, testInfo) => {
  const dir = writeTree(path.join(testInfo.outputPath(), "Fold Gallery"), {
    "Shots/Gallery A.png": png([0, 0, 255]),
    "Shots/Gallery B.png": png([255, 0, 0]),
  });

  await page.goto("/models");
  await pickFolder(page, dir);
  await expectUploaded(page, 2);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const shots = await api.folderAt("Fold Gallery", "Shots");
  const prints = await api.printsNamed("Gallery A", "Gallery B");
  expect(prints.map((p) => p.category_id)).toEqual([shots!.id, shots!.id]);
});
