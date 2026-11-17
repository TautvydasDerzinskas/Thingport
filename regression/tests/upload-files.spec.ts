import { file, png, stl, text, threeMf } from "./fixtures";
import { expect, expectUploaded, pickFiles, test } from "./helpers";

const OBJ_CUBE = text(["v 0 0 0", "v 10 0 0", "v 10 10 0", "v 0 10 0", "f 1 2 3", "f 1 3 4"].join("\n"));

test("a single STL opens for editing, named after the file, and gets a rendered thumbnail", async ({ page, api }) => {
  const before = await api.summary();
  await page.goto("/models");
  await pickFiles(page, file("Files Bracket.stl", stl()));

  await page.waitForURL(/\/models\/[^/?]+\?edit=/);
  const id = page.url().match(/\/models\/([^/?]+)/)![1];
  await expect(page.getByText('Uploaded "Files Bracket"')).toBeVisible();
  const edit = page.getByRole("dialog", { name: "Edit model" });
  await edit.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Files Bracket" })).toBeVisible();

  const print = await api.print(id);
  expect(print).toMatchObject({ name: "Files Bracket", category_id: null });
  expect(print.plates.map((p) => p.filename)).toEqual(["Files Bracket.stl"]);
  expect((await api.summary()).model_count).toBe(before.model_count + 1);

  // An STL has no embedded preview: the browser renders one and stores it as the plate thumbnail.
  await expect.poll(async () => (await api.print(id)).plates[0].thumb_url, { timeout: 30_000 }).toBeTruthy();
});

test("a 3MF uses the thumbnail embedded in it", async ({ page, api }) => {
  await page.goto("/models");
  await pickFiles(page, file("Files Gear Box.3mf", threeMf()));
  await page.waitForURL(/\/models\/[^/?]+\?edit=/);
  const id = page.url().match(/\/models\/([^/?]+)/)![1];

  // Extracted on upload, before anything renders it.
  const print = await api.print(id);
  expect(print.name).toBe("Files Gear Box");
  expect(print.plates[0].thumb_url).toBeTruthy();
  expect(print.thumb_url).toBe(print.plates[0].thumb_url);
});

test("an image uploads as a model of its own", async ({ page, api }) => {
  await page.goto("/models");
  await pickFiles(page, file("Files Poster.png", png(), "image/png"));
  await page.waitForURL(/\/models\/[^/?]+\?edit=/);
  const print = await api.print(page.url().match(/\/models\/([^/?]+)/)![1]);
  expect(print.name).toBe("Files Poster");
  expect(print.plates.map((p) => p.filename)).toEqual(["Files Poster.png"]);
  expect(print.plates[0].thumb_url).toBeTruthy();
});

test("several files can become separate models", async ({ page, api }) => {
  const before = await api.summary();
  await page.goto("/models");
  await pickFiles(page, [
    file("Sep Hinge.stl", stl()),
    file("Sep Clip.3mf", threeMf()),
    file("Sep Knob.obj", OBJ_CUBE),
    file("Sep Photo.png", png(), "image/png"),
  ]);

  const mode = page.getByRole("dialog", { name: /Import 4 files/ });
  await expect(mode).toContainText("Sep Hinge.stl, Sep Clip.3mf, Sep Knob.obj, Sep Photo.png");
  await mode.getByRole("button", { name: /Import as separate prints/ }).click();
  await expectUploaded(page, 4);
  await expect(mode).toBeHidden();

  const prints = await api.printsNamed("Sep Hinge", "Sep Clip", "Sep Knob", "Sep Photo");
  for (const p of prints) {
    expect(p.plates).toHaveLength(1);
    expect(p.category_id).toBeNull();
  }
  expect((await api.summary()).model_count).toBe(before.model_count + 4);

  await page.goto("/models");
  for (const name of ["Sep Hinge", "Sep Clip", "Sep Knob", "Sep Photo"]) {
    await expect(page.getByRole("main").getByText(name, { exact: true })).toBeVisible();
  }
});

test("several files can become one model, model files as plates in the order picked", async ({ page, api }) => {
  const before = await api.summary();
  await page.goto("/models");
  await pickFiles(page, [
    file("Multi Lid.stl", stl()),
    file("Multi Base.3mf", threeMf()),
    file("Multi Photo.png", png(), "image/png"),
    file("Multi Guide.pdf", text("%PDF-1.4 not really"), "application/pdf"),
  ]);

  await page
    .getByRole("dialog", { name: /Import 4 files/ })
    .getByRole("button", { name: /Import as one model with several files/ })
    .click();
  // One model, so it opens for editing like a single upload.
  await page.waitForURL(/\/models\/[^/?]+\?edit=/);
  const id = page.url().match(/\/models\/([^/?]+)/)![1];

  const print = await api.print(id);
  expect(print.name).toBe("Multi Lid");
  expect(print.plates.map((p) => p.filename)).toEqual(["Multi Lid.stl", "Multi Base.3mf"]);
  // A picture is the model's photo, as a folder's are; a document rides along as an attachment.
  expect(print.preview_images.filter((p) => !p.generated)).toHaveLength(1);
  expect((await api.files(id)).map((f) => f.filename)).toEqual(["Multi Guide.pdf"]);
  expect((await api.summary()).model_count).toBe(before.model_count + 1);
});

test("closing the import choice uploads nothing", async ({ page, api }) => {
  const before = await api.summary();
  await page.goto("/models");
  await pickFiles(page, [file("Closed A.stl", stl()), file("Closed B.stl", stl())]);
  const mode = page.getByRole("dialog", { name: /Import 2 files/ });
  await mode.getByRole("button", { name: "Close" }).click();
  await expect(mode).toBeHidden();
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
  expect((await api.summary()).model_count).toBe(before.model_count);
});
