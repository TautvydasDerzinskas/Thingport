import { expect, test, type Page } from "@playwright/test";
import { authToken, uploadCube } from "./helpers";

/** Allows subpixel rounding, but catches panels or cards extending beyond the viewport. */
async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}

// The regression runner owns a throwaway database and storage. Never run these
// upload scenarios against an existing instance or its production credentials.
for (const width of [320, 393, 768]) {
  test.describe(`mobile layout at ${width}px`, () => {
    test.use({ viewport: { width, height: 852 } });

    test("navigation overlays the page, closes on selection, and supports dismissal", async ({ page }) => {
      // A desktop preference must not turn mobile navigation into an icon rail.
      await page.addInitScript(() => localStorage.setItem("thingport_sidebar_collapsed", "true"));
      await page.goto("/models");
      const menu = page.getByRole("button", { name: "Open navigation menu" });
      const drawer = page.locator("#mobile-navigation");
      await expect(menu).toHaveAttribute("aria-expanded", "false");
      await expect(drawer).toBeHidden();
      const before = await page.getByRole("main").boundingBox();
      expect(before!.width).toBeGreaterThanOrEqual(width - 1);

      await menu.click();
      const dialog = page.getByRole("dialog", { name: "Navigation menu", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-modal", "true");
      await expect(drawer.getByRole("button", { name: "Models", exact: true })).toBeVisible();
      await drawer.getByRole("button", { name: "Collections", exact: true }).click();
      await expect(page).toHaveURL(/\/models\/collections$/);
      await expect(drawer).toBeHidden();

      await menu.click();
      await drawer.getByRole("button", { name: "Close navigation menu" }).click();
      await expect(drawer).toBeHidden();
      await menu.click();
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await menu.click();
      await drawer.locator(".MuiBackdrop-root").click({ position: { x: width - 5, y: 400 } });
      await expect(drawer).toBeHidden();
      await expectNoHorizontalOverflow(page);
    });

    test("category and folder filters do not squeeze model cards", async ({ page, request }) => {
      await page.goto("/models");
      const id = await uploadCube(page);
      const edit = page.getByRole("dialog", { name: "Edit model" });
      const title = `Mobile layout ${width}`;
      await edit.getByLabel("Title").fill(title);
      await edit.getByRole("button", { name: "Update" }).click();
      await expect(edit).toBeHidden();

      // Real assignments exercise non-null selection as well as the All/reset path.
      const headers = { Authorization: `Bearer ${await authToken(page)}` };
      const categoryResponse = await request.post("/api/categories", {
        headers,
        data: { name: `Mobile category ${width}`, kind: "category" },
      });
      expect(categoryResponse.ok()).toBeTruthy();
      const category: { id: string; name: string } = await categoryResponse.json();
      const folderResponse = await request.post("/api/categories", {
        headers,
        data: { name: `Mobile folder ${width}`, kind: "folder" },
      });
      expect(folderResponse.ok()).toBeTruthy();
      const folder: { id: string; name: string } = await folderResponse.json();
      const assignedCategory = await request.post(`/api/print/${id}/category`, {
        headers,
        data: { category_id: category.id },
      });
      expect(assignedCategory.ok()).toBeTruthy();

      await page.goto("/models");
      const main = page.getByRole("main");
      // Categories is already the saved view, and a toggle group ignores a click on the option it
      // has: the panel opens from its own button, which is also the only way in once a view is set.
      const filterButton = main.getByRole("button", { name: "Categories: All", exact: true });
      await filterButton.click();
      const filters = page.locator("#model-category-filters");
      // Rows are only clicked once the panel has finished opening: a row still below its growing edge is scrolled
      // to inside it, then moves as it grows, and the click lands on another row.
      const pick = async (name: string) => {
        await expect(filters).toHaveClass(/MuiCollapse-entered/);
        await filters.getByRole("button", { name, exact: true }).click();
      };
      await expect(filters).toBeVisible();
      await pick("All");
      await expect(filters).toBeHidden();

      const card = main.locator(".MuiPaper-root").filter({ has: page.getByText(title, { exact: true }) });
      await expect(card).toBeVisible();
      expect((await card.boundingBox())!.width).toBeGreaterThan(width - 60);
      await expectNoHorizontalOverflow(page);

      await filterButton.click();
      await expect(filterButton).toHaveAttribute("aria-expanded", "true");
      await filterButton.click();
      await expect(filters).toBeHidden();

      await filterButton.click();
      await pick(category.name);
      await expect(filters).toBeHidden();
      const selectedCategoryButton = main.getByRole("button", { name: `Categories: ${category.name}`, exact: true });
      await expect(selectedCategoryButton).toHaveAttribute("aria-expanded", "false");
      await expect.poll(() => new URL(page.url()).searchParams.get("category")).toBe(category.id);
      await expect(card).toBeVisible();
      await selectedCategoryButton.click();
      await pick("All");
      await expect(filters).toBeHidden();

      const assignedFolder = await request.post(`/api/print/${id}/category`, {
        headers,
        data: { category_id: folder.id },
      });
      expect(assignedFolder.ok()).toBeTruthy();
      await main.getByRole("button", { name: "Folders", exact: true }).click();
      await expect(filters.getByRole("heading", { name: "Folders" })).toBeVisible();
      await pick(folder.name);
      await expect(filters).toBeHidden();
      const selectedFolderButton = main.getByRole("button", { name: `Folders: ${folder.name}`, exact: true });
      await expect(selectedFolderButton).toHaveAttribute("aria-expanded", "false");
      await expect.poll(() => new URL(page.url()).searchParams.get("category")).toBe(folder.id);
      await expect(card).toBeVisible();
      await selectedFolderButton.click();
      await pick("All");
      await expect(filters).toBeHidden();
      await expectNoHorizontalOverflow(page);

      // A folder deep link must not label the Categories panel with a folder name.
      const savedView = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/settings/categories-view") &&
          response.request().method() === "PATCH" &&
          response.ok(),
      );
      await main.getByRole("button", { name: "Categories", exact: true }).click();
      await savedView;
      await page.goto(`/models?category=${folder.id}`);
      await expect(main.getByRole("button", { name: "Categories", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(main.getByRole("button", { name: "Categories: All", exact: true })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(main.getByRole("button", { name: `Categories: ${folder.name}`, exact: true })).toHaveCount(0);
      await expect(card).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // The card still opens the uploaded model after filtering.
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/models/${id}$`));
    });
  });
}

test("resizing restores desktop navigation without reopening the mobile drawer", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/admin");
  const menu = page.getByRole("button", { name: "Open navigation menu" });
  await menu.click();
  const drawer = page.locator("#mobile-navigation");
  await expect(drawer.getByRole("navigation", { name: "Administration" })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(menu).toBeHidden();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Administration" })).toBeVisible();
  await page.setViewportSize({ width: 393, height: 852 });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(drawer).toBeHidden();
});
