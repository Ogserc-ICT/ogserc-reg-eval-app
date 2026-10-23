import { expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./constants";

test.describe.serial("Phase 6: dashboard and queues", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(E2E_ADMIN.email);
    await page.getByLabel("Password").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("shows every §10 section, the queues and the charts", async ({ page }) => {
    for (const name of [
      "My assigned evaluations",
      "Deficiency responses overdue (awaiting lapse)",
      "Ready for decision",
      "Key dates",
      "Submissions",
      "Workflow",
      "Evaluation",
      "Money",
      "By Schedule 3 category",
    ]) {
      await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
    }
    for (const title of [
      "Monthly intake",
      "Collected by month",
      "Submissions by status",
      "Submissions by primary activity",
      "By principal LGA",
    ]) {
      await expect(page.getByRole("figure").filter({ hasText: title })).toBeVisible();
    }
    await expect(page.getByRole("meter", { name: "Collection rate" })).toBeVisible();
    // Category I row comes from own-use notifications.
    await expect(
      page.getByRole("row", { name: /^I Own-use generation notification/ }),
    ).toBeVisible();

    if (process.env.DASHBOARD_SCREENSHOT) {
      await page.screenshot({ path: process.env.DASHBOARD_SCREENSHOT, fullPage: true });
    }
  });

  test("chart values are reachable by hover, keyboard focus and the table view", async ({
    page,
  }) => {
    const status = page.getByRole("figure").filter({ hasText: "Submissions by status" });
    const registered = status.getByRole("listitem", { name: /^Registered: Submissions \d+$/ });
    await registered.hover();
    await expect(status.getByRole("tooltip")).toContainText("Registered");

    const monthly = page.getByRole("figure").filter({ hasText: "Monthly intake" });
    await monthly
      .getByRole("listitem", { name: /^\w+ \d{4}: Submissions/ })
      .first()
      .focus();
    await expect(monthly.getByRole("tooltip")).toContainText("Submissions");
    await expect(monthly.getByRole("tooltip")).toContainText("Registered");

    await monthly.getByText("Show as table").click();
    await expect(monthly.getByRole("columnheader", { name: "Submissions" })).toBeVisible();
  });

  test("stat tiles link to the records they count", async ({ page }) => {
    await page.getByRole("link", { name: /^Late submissions/ }).click();
    await expect(page).toHaveURL(/\/submissions\?late=1$/);
    await expect(page.getByRole("checkbox", { name: "Late submissions" })).toBeChecked();

    await page.goto("/");
    await page.getByRole("link", { name: /^Overpaid \/ credits/ }).click();
    await expect(page).toHaveURL(/\/submissions\?overpaid=1$/);
    await expect(page.getByRole("checkbox", { name: "Overpaid / credits" })).toBeChecked();

    await page.goto("/");
    await page.getByRole("link", { name: /^Unpaid on closed submissions/ }).click();
    await expect(page).toHaveURL(/\/submissions\?closedUnpaid=1$/);
    await expect(page.getByRole("checkbox", { name: "Unpaid on closed" })).toBeChecked();
  });

  test("the year selector shows one calendar year in the monthly charts", async ({ page }) => {
    const select = page.getByRole("combobox", { name: "Monthly charts" });
    const year = await select.locator("option").nth(1).getAttribute("value");
    await select.selectOption(year!);
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page).toHaveURL(new RegExp(`\\?year=${year}$`));
    await expect(page.getByRole("figure").filter({ hasText: "Monthly intake" })).toContainText(
      `January to December ${year}`,
    );
    await expect(page.getByRole("combobox", { name: "Monthly charts" })).toHaveValue(year!);
  });
});
