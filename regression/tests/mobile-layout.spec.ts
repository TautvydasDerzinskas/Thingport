import { expect, test, type Page } from "@playwright/test";
import { uploadCube } from "./helpers";

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

    test("category and folder filters do not squeeze model cards", async ({ page }) => {
      await page.goto("/models");
      const id = await uploadCube(page);
      const edit = page.getByRole("dialog", { name: "Edit model" });
      const title = `Mobile layout ${width}`;
      await edit.getByLabel("Title").fill(title);
      await edit.getByRole("button", { name: "Update" }).click();
      await expect(edit).toBeHidden();
      await page.goto("/models");
      const main = page.getByRole("main");
      await main.getByRole("button", { name: "Categories", exact: true }).click();
      const filters = page.locator("#model-category-filters");
      await expect(filters).toBeVisible();
      await filters.getByRole("button", { name: "All", exact: true }).click();
      await expect(filters).toBeHidden();

      const card = main.locator(".MuiPaper-root").filter({ has: page.getByText(title, { exact: true }) });
      await expect(card).toBeVisible();
      expect((await card.boundingBox())!.width).toBeGreaterThan(width - 60);
      await expectNoHorizontalOverflow(page);

      const filterButton = main.getByRole("button", { name: "Categories: All", exact: true });
      await filterButton.click();
      await expect(filterButton).toHaveAttribute("aria-expanded", "true");
      await filterButton.click();
      await expect(filters).toBeHidden();
      await main.getByRole("button", { name: "Folders", exact: true }).click();
      await expect(filters.getByRole("heading", { name: "Folders" })).toBeVisible();
      await filters.getByRole("button", { name: "All", exact: true }).click();
      await expect(filters).toBeHidden();
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
