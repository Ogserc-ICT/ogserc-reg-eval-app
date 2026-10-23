import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./constants";

const USERS = {
  registry: {
    name: "Ronke Registry",
    email: "ronke@ogserc.test",
    password: "ronke temp password",
    role: "Registry Officer",
  },
  evaluator: {
    name: "Evan Evaluator",
    email: "evan@ogserc.test",
    password: "evan temp password",
    role: "Evaluating Officer",
  },
  supervisor: {
    name: "Sade Supervisor",
    email: "sade@ogserc.test",
    password: "sade temp password",
    role: "Reviewing Supervisor",
  },
  approver: {
    name: "Ade Approver",
    email: "ade@ogserc.test",
    password: "ade temp password",
    role: "Approving Officer",
  },
} as const;
type Who = keyof typeof USERS;

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

async function as(browser: Browser, who: Who | "admin") {
  const page = await browser.newPage();
  const u = who === "admin" ? E2E_ADMIN : USERS[who];
  await signIn(page, u.email, u.password);
  return page;
}

async function openEvaluation(page: Page, name: string) {
  await page.goto("/submissions");
  await page.getByLabel("Search").fill(name);
  await page.getByRole("button", { name: "Apply" }).click();
  await page
    .getByRole("link", { name: /OGSERC\/ACK/ })
    .first()
    .click();
  await page.getByRole("link", { name: "Open evaluation (EVAL-01)" }).click();
  // The evaluation page is the heaviest to compile on its first visit to the dev server.
  await page.waitForURL(/\/evaluation$/, { timeout: 60_000 });
  await expect(
    page.getByRole("heading", { name: new RegExp(`Evaluation \\(EVAL-01\\): ${name}`) }),
  ).toBeVisible();
}

async function newSubmission(page: Page, name: string, cac: string) {
  await page.goto("/submissions/new");
  await page.getByLabel(/^Registered name/).fill(name);
  await page.getByLabel("CAC number").fill(cac);
  await page.getByLabel(/^Principal LGA/).selectOption("Odeda");
  await page.getByLabel(/^Primary activity/).selectOption("MGD");
  await page.getByLabel("Installed capacity (MW)").fill("3");
  await page
    .getByLabel(/^Licence status/)
    .selectOption("NERC registration/permit (mini-grid/captive)");
  await page.getByLabel("Licence number").fill("NERC/MG/77");
  await page.getByRole("button", { name: "Save submission" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

const SOLAR = "Abeokuta Solar Grid Ltd";
const SLOW = "Odeda Slow Response Ltd";

test.describe.serial("Phase 4: evaluation and workflow", () => {
  test("admin sets up officers and certificate signatories", async ({ browser }) => {
    const admin = await as(browser, "admin");
    for (const u of Object.values(USERS)) {
      await admin.goto("/admin/users/new");
      await admin.getByLabel("Full name").fill(u.name);
      await admin.getByLabel("Email").fill(u.email);
      await admin.getByLabel("Temporary password").fill(u.password);
      await admin.getByRole("checkbox", { name: new RegExp(u.role) }).check();
      await admin.getByRole("button", { name: "Create user" }).click();
      await expect(admin.getByRole("status")).toContainText("created");
    }
    await admin.goto("/admin/settings");
    await admin.getByLabel("Chairman / Chief Executive Officer").fill("Engr. E2E Chairman");
    await admin.getByLabel("Commissioner").fill("Barr. E2E Commissioner");
    await admin.getByRole("button", { name: "Save settings" }).click();
    await expect(admin.getByRole("status")).toHaveText("Settings saved.");
  });

  test("registry intake: documents and fee", async ({ browser }) => {
    const page = await as(browser, "registry");
    await newSubmission(page, SOLAR, "RC778899");
    for (let n = 1; n <= 13; n++) {
      await page.getByRole("radio", { name: new RegExp(`^${n}\\. .*: Received$`) }).check();
    }
    await page.getByRole("button", { name: "Save checklist" }).click();
    await expect(page.getByText(/^Checklist saved/)).toBeVisible();
    await page.getByRole("link", { name: "Record payment" }).click();
    await page.getByLabel(/^Amount/).fill("250000");
    await page.getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByText("Payment recorded.")).toBeVisible();
  });

  test("supervisor assigns the officers", async ({ browser }) => {
    const page = await as(browser, "supervisor");
    await openEvaluation(page, SOLAR);
    await page.getByLabel("Evaluating officer").selectOption({ label: USERS.evaluator.name });
    await page.getByLabel("Reviewing supervisor").selectOption({ label: USERS.supervisor.name });
    await page.getByLabel("Approving officer").selectOption({ label: USERS.approver.name });
    await page.getByRole("button", { name: "Save officers" }).click();
    await expect(page.getByText("Officers saved.")).toBeVisible();
  });

  test("approval is blocked with every reason while checks are pending", async ({ browser }) => {
    const page = await as(browser, "approver");
    await openEvaluation(page, SOLAR);
    const approve = page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Approve and register" }) });
    await expect(approve.getByText(/evaluation check\(s\) pending/)).toBeVisible();
    await expect(
      approve.getByText("Submission is not complete (documents or fees outstanding)"),
    ).toHaveCount(0);
    await expect(approve.getByRole("button", { name: "Approve and register" })).toBeDisabled();
  });

  test("evaluator answers the checks and marks the submission complete", async ({ browser }) => {
    const page = await as(browser, "evaluator");
    await openEvaluation(page, SOLAR);
    // Automatic checks show no radios.
    await expect(page.getByRole("radio", { name: "1.1: Y" })).toHaveCount(0);
    const yes = page.getByRole("radio", { name: /^\d+\.\d+: Y$/ });
    const count = await yes.count();
    expect(count).toBeGreaterThan(20);
    for (let i = 0; i < count; i++) await yes.nth(i).check();
    await page.getByRole("button", { name: "Save checks" }).click();
    await expect(page.getByText(/^Saved \(\d+ changes\)\.$/)).toBeVisible();
    await expect(page.getByText("Ready for decision")).toBeVisible();

    await page.getByRole("button", { name: "Mark complete" }).click();
    await expect(
      page.getByText("Marked complete. The determination clock has started."),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Next action" })).toContainText("Determine by");
  });

  test("supervisor records the review; the approver registers it", async ({ browser }) => {
    const sup = await as(browser, "supervisor");
    await openEvaluation(sup, SOLAR);
    await sup.getByRole("button", { name: "Record review" }).click();
    await expect(sup.getByText("Review recorded.")).toBeVisible();

    const page = await as(browser, "approver");
    await openEvaluation(page, SOLAR);
    await page.getByRole("button", { name: "Approve and register" }).click();
    await expect(page.getByText(/^Registered as OGSERC\/REG\/\d{4}\/E-MGD\/0001\.$/)).toBeVisible();

    await page
      .getByRole("link", { name: /OGSERC\/ACK/ })
      .first()
      .click();
    await expect(page.getByText("Registered", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/OGSERC\/REG\/\d{4}\/E-MGD\/0001/).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Next action" })).toContainText("Complete");

    // §4.6: the certificate is produced with the approval and stored.
    const cert = page.getByRole("row", { name: /Certificate of registration \(CERT-01\) v1/ });
    await expect(cert).toBeVisible();
    const href = await cert.getByRole("link", { name: "Open" }).getAttribute("href");
    const response = await page.request.get(href!);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    expect((await response.body()).length).toBeGreaterThan(100_000);
  });

  test("a deficiency notice cannot be lapsed before the response period ends", async ({
    browser,
  }) => {
    const reg = await as(browser, "registry");
    await newSubmission(reg, SLOW, "RC665544");

    const sup = await as(browser, "supervisor");
    await openEvaluation(sup, SLOW);
    await sup.getByRole("button", { name: "Issue deficiency notice" }).click();
    await expect(sup.getByText("Deficiency notice issued.")).toBeVisible();
    await expect(sup.getByText("Deficiency Notice Issued").first()).toBeVisible();

    const lapse = sup.locator("form").filter({ has: sup.getByRole("heading", { name: "Lapse" }) });
    await expect(lapse.getByText(/The response period runs until/)).toBeVisible();
    await expect(lapse.getByRole("button", { name: "Lapse submission" })).toBeDisabled();
    await expect(sup.getByRole("region", { name: "Next action" })).toContainText(
      "Await response by",
    );
  });

  test("the Evaluations list shows work assigned to me", async ({ browser }) => {
    const page = await as(browser, "evaluator");
    await page.goto("/evaluations?mine=1&closed=1");
    await expect(page.getByRole("cell", { name: SOLAR })).toBeVisible();
    await expect(page.getByRole("cell", { name: SLOW })).toHaveCount(0);
  });
});
