import { expect, test } from "@playwright/test";
import { ADMIN } from "./helpers";

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("rejects a wrong password", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText("Invalid email or password");
  });

  test("signs in with the right password", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();
  });

  // Signs in first, so it has a session of its own to end. Logging out deletes the session row rather than only
  // forgetting the token in this browser, so run against the signed-in state the rest of the pack shares, it
  // would revoke the very token they replay -- and every spec after this file, which is all of them, would 401.
  test("logs out", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();

    await page.getByRole("button", { name: ADMIN.displayName }).click();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    // The session is gone, not just hidden.
    await page.reload();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
