import { expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./constants";

test.describe.serial("Phase 8: fee table and activity map", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(E2E_ADMIN.email);
    await page.getByLabel("Password").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("an Admin changes a fee with a reason; it is audited", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("link", { name: /Fee table \(Schedule 3\)/ }).click();
    const fee = page.getByLabel("Category H registration fee");
    await expect(fee).toHaveValue("250,000");

    await fee.fill("260,000");
    await page.getByRole("button", { name: "Save fee table" }).click();
    // The browser asks for the required reason first.
    await expect(page.getByText(/Fee table saved/)).toHaveCount(0);

    await page.getByLabel("Reason for the change").fill("Schedule 3 revised (e2e)");
    await page.getByRole("button", { name: "Save fee table" }).click();
    await expect(page.getByText(/^Fee table saved: 1 category changed\./)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Category H registration fee")).toHaveValue("260,000");

    await page.goto("/audit?action=Fee+table+changed");
    await expect(page.getByRole("row", { name: /Category H/ })).toContainText(
      "registration fee ₦250,000 → ₦260,000. Reason: Schedule 3 revised (e2e)",
    );
  });

  test("the activity map refuses an inconsistent capacity setting", async ({ page }) => {
    await page.goto("/admin/activities");
    await page.getByLabel("SUP below 1 MW").selectOption("C");
    await page.getByLabel("Reason for the change").fill("Testing validation");
    await page.getByRole("button", { name: "Save activity map" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Please correct the highlighted fields." }),
    ).toBeVisible();
    await expect(page.getByText(/Categories differ by capacity/)).toBeVisible();
    // The edit is kept on screen for correction.
    await expect(page.getByLabel("SUP below 1 MW")).toHaveValue("C");
  });
});
