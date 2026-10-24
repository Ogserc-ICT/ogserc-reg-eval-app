import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./constants";

// The browser clock is faked (page.clock) so minutes of inactivity pass instantly. The server's
// own idle expiry is covered by tests/integration/auth.test.ts.

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_ADMIN.email);
  await page.getByLabel("Password").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test.describe.serial("inactivity sign-out", () => {
  test("warns after 3 minutes and signs out after 4", async ({ page }) => {
    await page.clock.install();
    await signIn(page);

    await page.clock.fastForward("02:50");
    await expect(page.getByRole("alert").filter({ hasText: "signed out in" })).toHaveCount(0);

    await page.clock.fastForward("00:15");
    await expect(page.getByRole("alert").filter({ hasText: "signed out in" })).toBeVisible();

    await page.clock.fastForward("01:00");
    await expect(page).toHaveURL(/\/login\?reason=idle/);
    await expect(page.getByText("You were signed out after 4 minutes of inactivity")).toBeVisible();

    // The session is really gone, not just hidden.
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/login/);
  });

  test("activity keeps the user signed in", async ({ page }) => {
    await page.clock.install();
    await signIn(page);

    await page.clock.fastForward("03:10");
    const warning = page.getByRole("alert").filter({ hasText: "signed out in" });
    await expect(warning).toBeVisible();
    await warning.getByRole("button", { name: "Stay signed in" }).click();
    await expect(warning).toHaveCount(0);

    await page.clock.fastForward("02:00");
    await page.mouse.move(400, 300);
    await page.mouse.move(420, 320);
    await page.clock.fastForward("02:00");
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });
});
