import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiGet, authToken, uploadCube } from "./helpers";

// Already in the server's normalised form (first letter upper, rest lower).
const TAG_A = "Regression-alpha";
const TAG_B = "Regression-beta";
const SHELF = "Regression Bookmarks";

const sidebar = (page: Page) => page.getByRole("complementary");
// The top bar's title is the first heading in main; some pages repeat it further down.
const pageTitle = (page: Page) => page.getByRole("main").getByRole("heading", { level: 6 }).first();
// dnd-kit marks each draggable row; nothing else in the sidebar has it.
const bookmarkRows = (page: Page) => sidebar(page).locator('[aria-roledescription="sortable"]');

/** The button flips optimistically, so wait for the save before navigating away. */
async function bookmark(page: Page, label: string) {
  const saved = page.waitForResponse((r) => r.url().endsWith("/bookmark") && r.ok());
  await page.getByRole("button", { name: label }).click();
  await saved;
  await expect(page.getByRole("button", { name: "Remove bookmark" })).toBeVisible();
}

/** A real pointer drag: dnd-kit only starts after a few pixels of travel. */
async function drag(page: Page, from: Locator, to: Locator) {
  const src = (await from.boundingBox())!;
  const dst = (await to.boundingBox())!;
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2 + 10, { steps: 5 });
  await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 15 });
  await page.mouse.up();
}

test("every section is reachable from the sidebar", async ({ page }) => {
  await page.goto("/models/collections");
  const nav = sidebar(page);
  const sections: [string, RegExp, string][] = [
    ["Dashboard", /\/$/, "Dashboard"],
    ["Models", /\/models$/, "Models"],
    ["Collections", /\/models\/collections$/, "Collections"],
    ["Tags", /\/models\/tags$/, "Tags"],
    ["Downloads", /\/downloads$/, "Downloads"],
    ["Administration", /\/admin$/, "Administration"],
  ];
  for (const [label, url, title] of sections) {
    await nav.getByRole("button", { name: label, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(pageTitle(page)).toHaveText(title);
    await expect(nav.getByRole("button", { name: label, exact: true })).toHaveClass(/Mui-selected/);
  }

  await nav.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test.describe("as a member", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("has no administration entry or route", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "Register" }).click();
    await page.getByLabel("Display Name").fill("Regression Member");
    await page.getByLabel("Email").fill("member@regression.test");
    await page.getByLabel(/^Password/).fill("regression-password");
    await page.getByLabel("Confirm Password").fill("regression-password");
    await page.getByRole("button", { name: "Create Account" }).click();

    const nav = sidebar(page);
    await expect(nav.getByRole("button", { name: "Downloads", exact: true })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Administration" })).toHaveCount(0);

    // The admin-only API guard once leaked onto the dashboard's routes.
    const models = page
      .getByRole("main")
      .locator(".MuiPaper-root")
      .filter({ has: page.getByText("Models", { exact: true }) });
    await expect(models.getByRole("heading", { level: 3 })).toHaveText("0");
    await expect(page.getByText("Failed to load your dashboard.")).toHaveCount(0);

    for (const path of ["/admin", "/admin-users", "/admin-storage", "/admin-ai"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
      await expect(pageTitle(page)).toHaveText("Dashboard");
    }
  });
});

test("bookmarks tags and collections and reorders them by dragging", async ({ page, request }) => {
  await page.goto("/models");
  await uploadCube(page);
  const edit = page.getByRole("dialog", { name: "Edit model" });
  // The tag input has no label of its own; it sits beside the "Tags" caption.
  const tagInput = edit.getByText("Tags", { exact: true }).locator("..").getByRole("textbox");
  await tagInput.fill(TAG_A);
  await tagInput.press("Enter");
  await tagInput.fill(TAG_B);
  await tagInput.press("Enter");
  await edit.getByRole("button", { name: "Update" }).click();
  await expect(edit).toBeHidden();

  await page.goto("/models/collections");
  // The page's own, ahead of the ones on collections other specs left behind.
  await page.getByRole("button", { name: "More", exact: true }).first().click();
  await page.getByRole("menuitem", { name: "New Collection" }).click();
  const form = page.getByRole("dialog", { name: "New Collection" });
  await form.getByLabel("Name").fill(SHELF);
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form).toBeHidden();

  // Bookmark from each detail page; the sidebar picks each one up without a reload.
  await page.getByText(SHELF, { exact: true }).click();
  await expect(pageTitle(page)).toHaveText(SHELF);
  await bookmark(page, "Bookmark collection");
  for (const tag of [TAG_A, TAG_B]) {
    await page.goto(`/models/tags/${tag}`);
    await expect(pageTitle(page)).toHaveText(tag);
    await bookmark(page, "Bookmark tag");
  }

  const nav = sidebar(page);
  await expect(nav.getByText("Bookmarks", { exact: true })).toBeVisible();
  await expect(bookmarkRows(page)).toHaveText([SHELF, TAG_A, TAG_B]);

  // A bookmark row navigates and shows as selected.
  await nav.getByRole("button", { name: SHELF }).click();
  await expect(page).toHaveURL(/\/models\/collections\/[^/]+$/);
  await expect(nav.getByRole("button", { name: SHELF })).toHaveClass(/Mui-selected/);

  // Last to first: the drop must not navigate, and the new order must reach the server.
  const urlBefore = page.url();
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/bookmarks/reorder") && r.ok());
  await drag(page, bookmarkRows(page).nth(2), bookmarkRows(page).nth(0));
  await saved;
  await expect(bookmarkRows(page)).toHaveText([TAG_B, SHELF, TAG_A]);
  expect(page.url()).toBe(urlBefore);

  // First to the middle.
  await drag(page, bookmarkRows(page).nth(0), bookmarkRows(page).nth(1));
  await expect(bookmarkRows(page)).toHaveText([SHELF, TAG_B, TAG_A]);

  await page.reload();
  await expect(bookmarkRows(page)).toHaveText([SHELF, TAG_B, TAG_A]);
  const entries = await apiGet(request, await authToken(page), "/api/bookmarks");
  expect(entries.map((e: { tag?: string; name?: string }) => e.tag ?? e.name)).toEqual([SHELF, TAG_B, TAG_A]);

  // Removing a bookmark drops it from the sidebar.
  await nav.getByRole("button", { name: TAG_B }).click();
  await expect(pageTitle(page)).toHaveText(TAG_B);
  await page.getByRole("button", { name: "Remove bookmark" }).click();
  await expect(bookmarkRows(page)).toHaveText([SHELF, TAG_A]);
});

test("collapses to an icon rail and expands again", async ({ page }) => {
  await page.goto("/");
  const nav = sidebar(page);
  const width = async () => (await nav.boundingBox())!.width;
  await expect.poll(width).toBe(240);

  await nav.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect.poll(width).toBe(72);
  await expect(nav.getByText("Models", { exact: true })).toBeHidden();
  await expect(nav.getByText("Bookmarks", { exact: true })).toBeHidden();
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveCount(0);

  // Icon-only rows keep their names (from the tooltip) and still navigate, bookmarks included.
  await nav.getByRole("button", { name: "Tags", exact: true }).click();
  await expect(page).toHaveURL(/\/models\/tags$/);
  await nav.getByRole("button", { name: TAG_A }).click();
  await expect(pageTitle(page)).toHaveText(TAG_A);
  await nav.getByRole("button", { name: "Administration" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  // Administration always folds it, beside its own menu, so there's nothing to expand there.
  await expect(nav.getByRole("button", { name: "Expand sidebar" })).toHaveCount(0);

  // The choice survives a reload.
  await page.goto("/");
  await page.reload();
  await expect.poll(width).toBe(72);

  await nav.getByRole("button", { name: "Expand sidebar" }).click();
  await expect.poll(width).toBe(240);
  await expect(nav.getByText("Models", { exact: true })).toBeVisible();
  await expect(bookmarkRows(page)).toHaveText([SHELF, TAG_A]);
  await page.reload();
  await expect.poll(width).toBe(240);
});
