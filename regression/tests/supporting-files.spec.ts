import { file, stl, text } from "./fixtures";
import { expect, test } from "./helpers";

// A PDF a browser's own viewer opens: one empty page is enough.
const PDF = text(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

test("a model's supporting files: listed in their tab, opened in place, linked, closed by Back and downloaded", async ({
  page,
  api,
  context,
}) => {
  const id = await api.upload(file("Supporting Frog.stl", stl(), "model/stl"));
  await api.addFile(id, file("README.md", text("# Wobbly frog\n\nPrint it at 0.2 mm.\n"), "text/markdown"));
  await api.addFile(id, file("Parts list.csv", text("part,qty\nscrew,4\n"), "text/csv"));
  await api.addFile(id, file("Assembly guide.pdf", PDF, "application/pdf"));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto(`/models/${id}`);
  await page.getByRole("tab", { name: /Supporting files/ }).click();
  for (const name of ["Assembly guide.pdf", "Parts list.csv", "README.md"]) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }

  // Opened in place: the page's link names the file, and its Markdown is drawn.
  await page.getByRole("button", { name: /^README\.md/ }).click();
  const viewer = page.getByRole("dialog", { name: "Supporting files" });
  await expect(viewer.getByRole("heading", { name: "Wobbly frog" })).toBeVisible();
  await expect(page).toHaveURL(/[?&]file=/);

  // Another file in the open viewer: its table.
  await viewer.getByRole("button", { name: /^Parts list\.csv/ }).click();
  await expect(viewer.getByRole("cell", { name: "screw" })).toBeVisible();

  // Its link is the page's, never the file's own address, which carries the sign-in token.
  await viewer.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText("Link copied")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(new RegExp(`/models/${id}\\?file=`));
  expect(copied).not.toContain("token=");

  // Back closes it, the page as it was.
  await page.goBack();
  await expect(viewer).toBeHidden();
  await expect(page).not.toHaveURL(/[?&]file=/);

  // Downloaded from its menu, under its own name.
  await page.getByRole("button", { name: "Actions for Assembly guide.pdf" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("Assembly guide.pdf");
});
