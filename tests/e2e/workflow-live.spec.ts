import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./constants";

// Runs after the phase specs (which expect the first acknowledgement to be 00001).

const LARA = {
  name: "Lara Registry",
  email: "live-registry@ogserc.test",
  password: "live registry password",
};
const FOLA = {
  name: "Fola Finance",
  email: "live-finance@ogserc.test",
  password: "live finance password",
};
const NAME = "Live Update Grid Ltd";

/** One poll interval plus time for the refresh to render. */
const LIVE = { timeout: 30_000 };

async function as(browser: Browser, who: { email: string; password: string }) {
  const page = await browser.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  return page;
}

const bell = (page: Page) => page.getByRole("button", { name: /^Notifications/ });

test.describe.serial("live updates and notifications", () => {
  test("admin creates a registry officer and a finance officer", async ({ browser }) => {
    const admin = await as(browser, E2E_ADMIN);
    for (const [who, role] of [
      [LARA, "Registry Officer"],
      [FOLA, "Finance Officer"],
    ] as const) {
      await admin.goto("/admin/users/new");
      await admin.getByLabel("Full name").fill(who.name);
      await admin.getByLabel("Email").fill(who.email);
      await admin.getByLabel("Temporary password").fill(who.password);
      await admin.getByRole("checkbox", { name: new RegExp(role) }).check();
      await admin.getByRole("button", { name: "Create user" }).click();
      await expect(admin.getByRole("status")).toContainText("created");
    }
  });

  test("Finance sees a new submission and a notification without refreshing", async ({
    browser,
  }) => {
    const finance = await as(browser, FOLA);
    await finance.goto("/submissions");
    await expect(finance.getByText(NAME)).toHaveCount(0);
    await expect(bell(finance)).toHaveAccessibleName("Notifications");

    const registry = await as(browser, LARA);
    await registry.goto("/submissions/new");
    await registry.getByLabel(/^Form filed/).selectOption("REG-01E");
    await registry.getByLabel(/^Registered name/).fill(NAME);
    await registry.getByLabel("CAC number").fill("RC 990011");
    await registry.getByLabel(/^Principal LGA/).selectOption("Ifo");
    await registry.getByLabel(/^Primary activity/).selectOption("MGD");
    await registry.getByLabel("Installed capacity (MW)").fill("2.5");
    await registry
      .getByLabel(/^Licence status/)
      .selectOption("NERC registration/permit (mini-grid/captive)");
    await registry.getByRole("button", { name: "+ Add licence" }).click();
    await registry.getByLabel("Number, row 1").fill("NERC/MG/77");
    await registry.getByRole("button", { name: "Save submission" }).click();
    await expect(registry.getByRole("heading", { name: NAME })).toBeVisible();
    // The person who acted is not notified.
    await expect(bell(registry)).toHaveAccessibleName("Notifications");

    // Finance's open Register page picks up the new row, and the bell shows one unread.
    await expect(finance.getByText(NAME).first()).toBeVisible(LIVE);
    await expect(bell(finance)).toHaveAccessibleName("Notifications, 1 unread", LIVE);

    await bell(finance).click();
    const panel = finance.getByRole("dialog", { name: "Notifications" });
    await expect(panel.getByText("New submission awaiting payment")).toBeVisible();
    await panel.getByRole("button", { name: /New submission awaiting payment/ }).click();
    await expect(finance.getByRole("heading", { name: NAME })).toBeVisible();
    await expect(bell(finance)).toHaveAccessibleName("Notifications", LIVE);

    await bell(finance).click();
    await expect(panel.getByText("(unread)")).toHaveCount(0);
  });
});
