import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./constants";

const REMI = { name: "Remi Registry", email: "remi@ogserc.test", password: "remi temp password" };
const FEMI = { name: "Femi Finance", email: "femi@ogserc.test", password: "femi temp password" };

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

async function as(browser: Browser, who: { email: string; password: string }) {
  const page = await browser.newPage();
  await signIn(page, who.email, who.password);
  return page;
}

async function fillSubmission(page: Page, name: string, cac: string) {
  await page.getByLabel(/^Registered name/).fill(name);
  await page.getByLabel("CAC number").fill(cac);
  await page.getByLabel(/^Principal LGA/).selectOption("Ifo");
  await page.getByLabel(/^Primary activity/).selectOption("MGD");
  await page.getByLabel("Installed capacity (MW)").fill("2.5");
  await page
    .getByLabel(/^Licence status/)
    .selectOption("NERC registration/permit (mini-grid/captive)");
  await page.getByLabel("Licence number").fill("NERC/MG/9");
  await page.getByLabel("Phone").fill("08012345678");
}

const nextAction = (page: Page) => page.getByRole("region", { name: "Next action" });

test.describe.serial("Phase 3: intake, documents, payments, own-use", () => {
  test("admin creates a registry officer and a finance officer", async ({ browser }) => {
    const admin = await as(browser, E2E_ADMIN);
    for (const [who, role] of [
      [REMI, "Registry Officer"],
      [FEMI, "Finance Officer"],
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

  test("registry officer saves a submission and sees its calculated fields", async ({
    browser,
  }) => {
    const page = await as(browser, REMI);
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Register" })
      .click();
    await page.getByRole("link", { name: "New submission" }).click();

    // Missing required fields are refused on the server, and typed values survive.
    await page.getByLabel(/^Registered name/).fill("Ogun Sunrise Mini-Grid Ltd");
    await page.getByRole("button", { name: "Save submission" }).click();
    await expect(page.getByText("Please correct the highlighted fields.")).toBeVisible();
    await expect(page.getByLabel(/^Registered name/)).toHaveValue("Ogun Sunrise Mini-Grid Ltd");

    await fillSubmission(page, "Ogun Sunrise Mini-Grid Ltd", "RC 445566");
    await page.getByRole("button", { name: "Save submission" }).click();

    await expect(page.getByRole("heading", { name: "Ogun Sunrise Mini-Grid Ltd" })).toBeVisible();
    await expect(page.getByText(/^OGSERC\/ACK\/\d{4}\/00001$/)).toBeVisible();
    await expect(page.getByText("E – Mini-grids and interconnected mini-grids")).toBeVisible();
    await expect(nextAction(page)).toContainText(
      "Await payment of ₦250,000, then Finance confirmation",
    );
  });

  test("documents, then a payment, move the next action on", async ({ browser }) => {
    const page = await as(browser, REMI);
    await page.goto("/submissions");
    await page.getByRole("link", { name: /OGSERC\/ACK\/\d{4}\/00001/ }).click();

    for (let n = 1; n <= 13; n++) {
      const label = n === 13 ? /^13\. .*: N\/A$/ : new RegExp(`^${n}\\. .*: Received$`);
      await page.getByRole("radio", { name: label }).check();
    }
    await page.getByRole("button", { name: "Save checklist" }).click();
    await expect(page.getByRole("status")).toContainText("Checklist saved (13 changes)");
    // Awaiting payment (§4.12): documents do not move it on until Finance confirms the fee.
    await expect(nextAction(page)).toContainText(
      "Await payment of ₦250,000, then Finance confirmation",
    );

    await page.getByRole("link", { name: "Record payment" }).click();
    await expect(page.getByLabel(/^Ack No\. or OUN No\./)).toHaveValue(/OGSERC\/ACK\/\d{4}\/00001/);
    await page.getByLabel(/^Amount/).fill("250,000");
    await page.getByLabel("RRR / bank reference").fill("RRR-445566");
    await page.getByRole("button", { name: "Record payment" }).click();

    await expect(page.getByText("Payment recorded.")).toBeVisible();
    // §4.12: recorded payments wait for Finance; they count once confirmed.
    await expect(page.getByText("Pending", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Stage 2:")).toBeVisible();
    await expect(nextAction(page)).toContainText("Payment with Finance – awaiting confirmation");
  });

  test("a CAC number already on the Register needs confirmation (para 11(4))", async ({
    browser,
  }) => {
    const page = await as(browser, REMI);
    await page.goto("/submissions/new");
    await fillSubmission(page, "Sunrise Second Site Ltd", "RC445566");
    await page.getByRole("button", { name: "Save submission" }).click();
    await expect(page.getByText(/is already on the Register .* Save anyway\?/)).toBeVisible();
    await page.getByLabel("Yes, I have checked and want to save anyway").check();
    await page.getByRole("button", { name: "Save submission" }).click();
    await expect(page.getByRole("heading", { name: "Sunrise Second Site Ltd" })).toBeVisible();
    await expect(page.getByText("Duplicate CAC number on another submission")).toBeVisible();
  });

  test("the Register searches and filters", async ({ browser }) => {
    const page = await as(browser, REMI);
    await page.goto("/submissions");
    await page.getByLabel("Search").fill("second site");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("link", { name: /\/00002$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /\/00001$/ })).toHaveCount(0);

    // The recorded payment is not confirmed yet, so 00001 is still unpaid.
    await page.goto("/submissions?payment=Unpaid");
    await expect(page.getByRole("link", { name: /\/00001$/ })).toBeVisible();
    await page.goto("/submissions?payment=Paid");
    await expect(page.getByRole("link", { name: /\/00001$/ })).toHaveCount(0);
  });

  test("finance reverses a payment with a reason; it stays visible and stops counting", async ({
    browser,
  }) => {
    const page = await as(browser, FEMI);
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Payments" })
      .click();
    await page.getByRole("button", { name: "Reverse…" }).click();
    await page.getByLabel("Reason for reversal").fill("Posted twice by the bank");
    await page.getByRole("button", { name: "Reverse payment" }).click();
    await expect(
      page.getByText(/Reversed .* by Femi Finance: Posted twice by the bank/),
    ).toBeVisible();

    await page.goto("/submissions?payment=Paid");
    await expect(page.getByText("No submissions match.")).toBeVisible();
  });

  test("own-use: below the threshold needs confirmation; 650 kW owes the Category I fee", async ({
    browser,
  }) => {
    const page = await as(browser, REMI);
    const fill = async (name: string, kw: string) => {
      await page.goto("/own-use/new");
      await page.getByLabel(/^Name/).fill(name);
      await page.getByLabel(/^LGA/).selectOption("Ewekoro");
      await page.getByLabel(/^Installed capacity \(kW\)/).fill(kw);
      await page.getByRole("button", { name: "Save notification" }).click();
    };
    await fill("Tiny Bakery", "150");
    await expect(page.getByText(/does not need to notify \(para 3\(4\)\)/)).toBeVisible();
    await page.getByLabel("Yes, I have checked and want to save anyway").check();
    await page.getByRole("button", { name: "Save notification" }).click();
    await expect(page.getByText("Not required", { exact: true }).first()).toBeVisible();

    await fill("Ewekoro Cement Works", "650");
    await expect(page.getByText("Notification required", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("₦100,000").first()).toBeVisible();
  });

  test("admin bulk-recalculates after the Effective Date changes", async ({ browser }) => {
    const admin = await as(browser, E2E_ADMIN);
    await admin.goto("/admin/settings");
    await admin.getByLabel("Effective Date of the Order").fill("2026-09-01");
    await admin.getByRole("button", { name: "Save settings" }).click();
    await expect(admin.getByRole("status")).toHaveText("Settings saved.");

    await admin.goto("/submissions?stale=1");
    await expect(admin.getByRole("link", { name: /\/00001$/ })).toBeVisible();
    await admin.getByRole("checkbox", { name: "Select all on this page" }).check();
    await admin.getByLabel("Reason").fill("Gazetted Effective Date");
    await admin.getByRole("button", { name: "Recalculate" }).click();
    await expect(admin.getByRole("status")).toContainText("2 recalculated");

    await admin.goto("/submissions?stale=1");
    await expect(admin.getByText("No submissions match.")).toBeVisible();
  });
});
