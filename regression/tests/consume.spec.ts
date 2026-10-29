import fs from "node:fs";
import path from "node:path";
import { png, stl, text, threeMf, writeTree, zip } from "./fixtures";
import { type Api, expect, test } from "./helpers";

// Bind-mounted into the backend at /app/consume (docker-compose.yml); run.sh creates and removes it.
const CONSUME = path.join(__dirname, "..", "consume");
const NOT_IMPORTED = path.join(CONSUME, "Not imported");
// The watcher polls every 2s and takes a batch after two identical polls.
const BATCH_TIMEOUT = 30_000;

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .toSorted();
}

/** Drops `files` in, then waits until the watcher has taken all of them. */
async function consume(files: Record<string, Uint8Array>) {
  writeTree(CONSUME, files);
  await expect
    .poll(() => filesUnder(CONSUME).filter((f) => !f.startsWith("Not imported/")), { timeout: BATCH_TIMEOUT })
    .toEqual([]);
}

/** The notification for the batch, which lands just after its files have been taken. */
async function notification(api: Api, title: string) {
  await expect
    .poll(async () => (await api.notifications()).filter((n) => n.title === title).length, { timeout: 10_000 })
    .toBe(1);
  return (await api.notifications()).find((n) => n.title === title)!;
}

test.beforeEach(async ({ api }) => {
  fs.rmSync(NOT_IMPORTED, { recursive: true, force: true });
  await api.setConsume({ mode: "separate" });
});

test("each file becomes a model and each directory a folder, leaving the folder empty", async ({ page, api }) => {
  const before = await api.summary();
  await consume({
    "Cons Loose.stl": stl(),
    "Cons Shelf/Cons Gear.3mf": threeMf(),
    "Cons Shelf/Cons Pic.png": png(),
    "Cons Shelf/.DS_Store": text("junk"),
    "Cons Shelf/Deep/Cons Bolt.stl": stl(),
  });

  const shelf = await api.folderAt("Cons Shelf");
  const deep = await api.folderAt("Cons Shelf", "Deep");
  expect(shelf?.kind).toBe("folder");
  const [loose, gear, pic, bolt] = await api.printsNamed("Cons Loose", "Cons Gear", "Cons Pic", "Cons Bolt");
  expect(loose.category_id).toBeNull();
  expect([gear.category_id, pic.category_id]).toEqual([shelf!.id, shelf!.id]);
  expect(bolt.category_id).toBe(deep!.id);
  expect(gear.plates[0].thumb_url).toBeTruthy();
  expect(pic.plates[0].thumb_url).toBeTruthy();

  const after = await api.summary();
  expect(after.model_count).toBe(before.model_count + 4);
  expect(after.category_count).toBe(before.category_count + 2);
  // Emptied folders go too, system files and all.
  expect(fs.readdirSync(CONSUME)).toEqual([]);

  const note = await notification(api, "Imported 4 models from the consume folder");
  expect(note.body).toBe("4 files moved into the library.");

  // The bell only polls every 45s, so reload to pick it up.
  await page.goto("/");
  await page.getByRole("button", { name: "Notifications" }).click();
  await page.getByRole("menuitem", { name: /Imported 4 models from the consume folder/ }).click();
  await expect(page).toHaveURL(/\/models$/);
});

test("in folder mode, set from the admin settings, each folder of model files is one model", async ({ page, api }) => {
  await page.goto("/admin-storage");
  await expect(page.getByText("Watching /app/consume.", { exact: false })).toBeVisible();
  await page.getByRole("radio", { name: /^Each folder is one model/ }).check();
  await page.getByRole("button", { name: "Save consume settings" }).click();
  await expect(page.getByText("Consume settings saved.")).toBeVisible();
  expect((await api.consume()).mode).toBe("folder");

  const before = await api.summary();
  await consume({
    "Cons Lib/Cons Robot/robot body.stl": stl(),
    "Cons Lib/Cons Robot/robot arm.3mf": threeMf(),
    "Cons Lib/Cons Robot/front.png": png(),
    "Cons Lib/Cons Robot/notes.txt": text("print at 0.2mm"),
    "Cons Lib/Cons Vase/vase.stl": stl(),
  });

  const lib = await api.folderAt("Cons Lib");
  expect(await api.folderAt("Cons Lib", "Cons Robot")).toBeUndefined();
  const [robot, vase] = await api.printsNamed("Cons Robot", "Cons Vase");
  expect(robot).toMatchObject({ title: "Cons Robot", category_id: lib!.id });
  expect(robot.plates.map((p) => p.filename)).toEqual(["robot arm.3mf", "robot body.stl"]);
  expect(robot.plates[0].thumb_url).toBeTruthy();
  expect(robot.preview_images).toHaveLength(1);
  expect((await api.files(robot.id)).map((f) => f.filename)).toEqual(["notes.txt"]);
  expect(vase.plates.map((p) => p.filename)).toEqual(["vase.stl"]);
  expect(vase.preview_images).toEqual([]);

  const after = await api.summary();
  expect(after.model_count).toBe(before.model_count + 2);
  expect(after.category_count).toBe(before.category_count + 1);
  const note = await notification(api, "Imported 2 models from the consume folder");
  // Two plates, one preview and one attachment, plus the vase.
  expect(note.body).toBe("5 files moved into the library.");
});

test("a zip unpacks as a folder named after it, without doubling a folder it already has", async ({ api }) => {
  await consume({
    "Cons Kit.zip": zip({
      "Kit Arm.stl": stl(),
      "Parts/Kit Claw.3mf": threeMf(),
      "__MACOSX/Parts/._Kit Claw.3mf": text("resource fork"),
      "Parts/.DS_Store": text("junk"),
    }),
    "Cons Nest/Cons Benchy.zip": zip({ "Cons Benchy/Benchy Hull.stl": stl() }),
  });

  const kit = await api.folderAt("Cons Kit");
  const parts = await api.folderAt("Cons Kit", "Parts");
  const benchy = await api.folderAt("Cons Nest", "Cons Benchy");
  expect(await api.folderAt("Cons Nest", "Cons Benchy", "Cons Benchy")).toBeUndefined();
  expect(await api.folderAt("Cons Kit", "__MACOSX")).toBeUndefined();
  const [arm, claw, hull] = await api.printsNamed("Kit Arm", "Kit Claw", "Benchy Hull");
  expect(arm.category_id).toBe(kit!.id);
  expect(claw.category_id).toBe(parts!.id);
  expect(hull.category_id).toBe(benchy!.id);

  await notification(api, "Imported 3 models from the consume folder");
  expect(fs.readdirSync(CONSUME)).toEqual([]);
});

test("what can't be imported is set aside in Not imported, and left there", async ({ api }) => {
  await consume({
    "Cons Bad/Cons Fine.stl": stl(),
    "Cons Bad/notes.txt": text("not a model"),
    "Cons Bad/broken.zip": text("not a zip"),
    // Over the stack's IMPORT_MAX_MB=1.
    "Cons Bad/huge.stl": new Uint8Array(1024 * 1024 + 1),
  });

  expect(filesUnder(NOT_IMPORTED)).toEqual(["Cons Bad/broken.zip", "Cons Bad/huge.stl", "Cons Bad/notes.txt"]);
  const [fine] = await api.printsNamed("Cons Fine");
  const note = await notification(api, "Imported 1 model from the consume folder");
  expect(note.body).toBe(
    '1 file moved into the library. 3 files couldn\'t be imported and were moved to "Not imported" in the consume folder.',
  );
  // One model, so the notification opens it.
  expect(note.internal_path).toBe(`/models/${fine.id}`);

  // A second failure with the same name doesn't overwrite the first.
  const notesBefore = (await api.notifications()).length;
  await consume({ "Cons Bad/notes.txt": text("still not a model") });
  await expect.poll(() => filesUnder(NOT_IMPORTED), { timeout: BATCH_TIMEOUT }).toContain("Cons Bad/notes (2).txt");
  await expect.poll(async () => (await api.notifications()).length).toBe(notesBefore + 1);

  // Set-aside files are never retried.
  await new Promise((r) => setTimeout(r, 6_000));
  expect(filesUnder(NOT_IMPORTED)).toEqual([
    "Cons Bad/broken.zip",
    "Cons Bad/huge.stl",
    "Cons Bad/notes (2).txt",
    "Cons Bad/notes.txt",
  ]);
  expect((await api.notifications()).length).toBe(notesBefore + 1);
});

test("imports go to the library of the account chosen in settings", async ({ api, request }) => {
  const res = await request.post("/api/register", {
    data: { email: "consumer@regression.test", password: "regression-password", displayName: "Regression Consumer" },
  });
  expect(res.ok()).toBe(true);
  const registered = await res.json();
  const member = api.as(registered.token);
  const memberId = registered.user.id;
  const adminId = (await api.consume()).user_id!;

  await api.setConsume({ user_id: memberId });
  try {
    const adminBefore = await api.summary();
    await consume({ "Cons Shared/Cons Members Part.stl": stl() });
    await notification(member, "Imported 1 model from the consume folder");
    const [part] = await member.printsNamed("Cons Members Part");
    expect(part.category_id).toBe((await member.folderAt("Cons Shared"))!.id);
    expect((await member.summary()).model_count).toBe(1);
    expect((await api.summary()).model_count).toBe(adminBefore.model_count);
    expect(await api.folderAt("Cons Shared")).toBeUndefined();
  } finally {
    await api.setConsume({ user_id: adminId });
  }
});

test("a file still being written is only taken once it stops changing", async ({ api }) => {
  const target = path.join(CONSUME, "Cons Slow.stl");
  const chunk = Buffer.alloc(100 * 1024, "x");
  // Grows for ~5s, longer than the 2s between polls.
  fs.writeFileSync(target, chunk);
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 800));
    fs.appendFileSync(target, chunk);
  }
  await consume({});

  const [slow] = await api.printsNamed("Cons Slow");
  expect(slow.plates[0].size).toBe(7 * chunk.length);
});
