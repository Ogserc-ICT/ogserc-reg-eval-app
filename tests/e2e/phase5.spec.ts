import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./constants";

const REG = { name: "Rafiu Registry", email: "rafiu@ogserc.test", password: "rafiu temp password" };

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test.describe.serial("Phase 5: documents", () => {
  test("admin creates a registry officer", async ({ page }) => {
    await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
    await page.goto("/admin/users/new");
    await page.getByLabel("Full name").fill(REG.name);
    await page.getByLabel("Email").fill(REG.email);
    await page.getByLabel("Temporary password").fill(REG.password);
    await page.getByRole("checkbox", { name: /Registry Officer/ }).check();
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByRole("status")).toContainText("created");
  });

  test("saving a submission produces the acknowledgement letter as a stored PDF", async ({
    page,
  }) => {
    await signIn(page, REG.email, REG.password);
    await page.goto("/submissions/new");
    await page.getByLabel(/^Form filed/).selectOption("REG-01G");
    await page.getByLabel(/^Registered name/).fill("Ijebu Ode Solar Estate Ltd");
    await page.getByLabel(/^Principal LGA/).selectOption("Ijebu Ode");
    await page.getByLabel(/^Primary activity/).selectOption("EST");
    await page.getByLabel(/^Licence status/).selectOption("Unlicensed");
    await page.getByRole("button", { name: "Save submission" }).click();
    await expect(page.getByRole("heading", { name: "Ijebu Ode Solar Estate Ltd" })).toBeVisible();
    await expect(
      page.getByText("The acknowledgement letter is under Issued documents below."),
    ).toBeVisible();

    const row = page.getByRole("row", { name: /Acknowledgement letter v1/ });
    await expect(row).toBeVisible();
    const href = await row.getByRole("link", { name: "Open" }).getAttribute("href");
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");

    const download = await page.request.get(`${href}?download=1`);
    expect(download.headers()["content-disposition"]).toMatch(
      /^attachment; filename="OGSERC-ACK-\d{4}-\d{5}-acknowledgement-v1\.pdf"$/,
    );

    // §4.12: the evaluation form waits for Finance to confirm payment.
    await page.getByRole("button", { name: "Print evaluation form (EVAL-01)" }).click();
    await expect(
      page.getByText("Evaluation form is not available until Finance confirms payment."),
    ).toBeVisible();
    await expect(page.getByRole("row", { name: /Evaluation form \(EVAL-01\) v1/ })).toHaveCount(0);
  });

  test("documents cannot be fetched when signed out", async ({ browser }) => {
    const signedIn = await browser.newPage();
    await signIn(signedIn, REG.email, REG.password);
    await signedIn.goto("/submissions");
    await signedIn
      .getByRole("link", { name: /OGSERC\/ACK/ })
      .first()
      .click();
    const href = await signedIn.getByRole("link", { name: "Open" }).first().getAttribute("href");

    const anonymous = await browser.newContext();
    const response = await anonymous.request.get(href!, { maxRedirects: 0 });
    expect([302, 307]).toContain(response.status());
    expect(response.headers()["location"]).toContain("/login");
    await anonymous.close();
  });
});
