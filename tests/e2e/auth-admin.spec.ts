import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./constants";

const REGISTRY = {
  name: "Rita Registry",
  email: "rita@ogserc.test",
  password: "rita temp password",
};

async function attemptSignIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Sign in and wait until the session is established. */
async function signIn(page: Page, email: string, password: string) {
  await attemptSignIn(page, email, password);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test.describe.serial("sign-in, users and settings", () => {
  test("pages need a signed-in user", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a wrong password is refused", async ({ page }) => {
    await attemptSignIn(page, E2E_ADMIN.email, "not the password");
    await expect(page.getByText(/^Invalid email or password/)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("admin creates a user, keeping input after a validation error", async ({ page }) => {
    await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Admin" })
      .click();
    await page.getByRole("link", { name: /Users and roles/ }).click();
    await page.getByRole("link", { name: "New user" }).click();

    await page.getByLabel("Full name").fill(REGISTRY.name);
    await page.getByLabel("Email").fill(REGISTRY.email);
    await page.getByLabel("Temporary password").fill(REGISTRY.password);
    await page.getByRole("button", { name: "Create user" }).click();
    // No role chosen: refused on the server, and the typed values survive.
    await expect(page.getByText("Choose at least one role")).toBeVisible();
    await expect(page.getByLabel("Full name")).toHaveValue(REGISTRY.name);

    await page.getByLabel("Temporary password").fill(REGISTRY.password);
    await page.getByRole("checkbox", { name: /Registry Officer/ }).check();
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByRole("status")).toContainText(`User ${REGISTRY.email} created.`);

    await page.getByRole("link", { name: "Users and roles" }).click();
    await expect(page.getByRole("row", { name: new RegExp(REGISTRY.name) })).toContainText(
      "Registry Officer",
    );
  });

  test("admin saves settings", async ({ page }) => {
    await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
    await page.goto("/admin/settings");
    await expect(
      page.getByText("Certificates cannot be issued until both names are set"),
    ).toBeVisible();
    await page.getByLabel("Chairman / Chief Executive Officer").fill("Engr. Test Chairman");
    await page.getByLabel("Commissioner").fill("Barr. Test Commissioner");
    await page.getByLabel("Unresolved data flags block approval outright").check();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("status")).toHaveText("Settings saved.");

    await page.reload();
    await expect(page.getByLabel("Chairman / Chief Executive Officer")).toHaveValue(
      "Engr. Test Chairman",
    );
    await expect(page.getByLabel("Unresolved data flags block approval outright")).toBeChecked();
    await expect(
      page.getByText("Certificates cannot be issued until both names are set"),
    ).toBeHidden();
  });

  test("a registry officer cannot reach admin pages", async ({ page }) => {
    await signIn(page, REGISTRY.email, REGISTRY.password);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Admin" }),
    ).toHaveCount(0);
    for (const path of ["/admin", "/admin/users", "/admin/users/new", "/admin/settings"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Not allowed" })).toBeVisible();
    }
  });

  test("deactivating a user signs them out at once", async ({ browser }) => {
    const rita = await browser.newPage();
    await signIn(rita, REGISTRY.email, REGISTRY.password);
    await expect(rita.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    const admin = await browser.newPage();
    await signIn(admin, E2E_ADMIN.email, E2E_ADMIN.password);
    await admin.goto("/admin/users");
    await admin.getByRole("link", { name: REGISTRY.name }).click();
    await admin.getByLabel(/^Active/).uncheck();
    await admin.getByRole("button", { name: "Save changes" }).click();
    await expect(admin.getByRole("status")).toHaveText("Changes saved.");

    await rita.reload();
    await expect(rita).toHaveURL(/\/login/);
    await attemptSignIn(rita, REGISTRY.email, REGISTRY.password);
    await expect(rita.getByText(/^Invalid email or password/)).toBeVisible();
  });

  test("the session cookie is httpOnly, SameSite=Lax and carries an opaque random token", async ({
    page,
    context,
  }) => {
    await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
    const cookie = (await context.cookies()).find((c) => c.name.endsWith("authjs.session-token"));
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    expect(cookie?.value).toMatch(/^[0-9a-f]{64}$/);
    // `Secure` is forced on when NODE_ENV=production; this dev server runs over plain http.
  });

  test("five wrong passwords lock an account until an admin unlocks it", async ({ browser }) => {
    const LOLA = { name: "Lola Viewer", email: "lola@ogserc.test", password: "lola temp password" };
    const admin = await browser.newPage();
    await signIn(admin, E2E_ADMIN.email, E2E_ADMIN.password);
    await admin.goto("/admin/users/new");
    await admin.getByLabel("Full name").fill(LOLA.name);
    await admin.getByLabel("Email").fill(LOLA.email);
    await admin.getByLabel("Temporary password").fill(LOLA.password);
    await admin.getByRole("checkbox", { name: /Viewer/ }).check();
    await admin.getByRole("button", { name: "Create user" }).click();
    await expect(admin.getByRole("status")).toContainText("created");

    const lola = await browser.newPage();
    for (let i = 1; i <= 4; i++) {
      await attemptSignIn(lola, LOLA.email, `wrong ${i}`);
      await expect(lola.getByText(/^Invalid email or password/)).toBeVisible();
    }
    await attemptSignIn(lola, LOLA.email, "wrong 5");
    await expect(lola.getByText(/^Too many failed attempts/)).toBeVisible();
    await attemptSignIn(lola, LOLA.email, LOLA.password);
    await expect(lola.getByText(/^Too many failed attempts/)).toBeVisible();

    await admin.goto("/admin/users");
    await expect(admin.getByRole("row", { name: new RegExp(LOLA.name) })).toContainText("Locked");
    await admin.getByRole("link", { name: LOLA.name }).click();
    await admin.getByRole("button", { name: "Unlock now" }).click();
    await expect(admin.getByText(/^Locked after too many failed sign-ins/)).toBeHidden();

    await signIn(lola, LOLA.email, LOLA.password);
  });

  test("signing out ends the session", async ({ page }) => {
    await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });
});
