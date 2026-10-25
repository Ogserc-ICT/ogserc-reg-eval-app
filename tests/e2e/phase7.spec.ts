import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { E2E_ADMIN } from "./constants";

const ACK = "OGSERC/ACK/2026/09002";
const REG = "OGSERC/REG/2026/F-MSL/0901";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_ADMIN.email);
  await page.getByLabel("Password").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

/** The reference workbook, renumbered so it cannot clash with records other tests created. */
async function workbookFile(dir: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile("reference/OGSERC_Registration_and_Evaluation_System.xlsm");
  wb.getWorksheet("Register")!.getCell("B6").value = ACK;
  wb.getWorksheet("Register")!.getCell("AZ6").value = REG;
  wb.getWorksheet("Document Checklist")!.getCell("A6").value = ACK;
  wb.getWorksheet("Evaluation")!.getCell("A6").value = ACK;
  wb.getWorksheet("Payments")!.getCell("A7").value = "OGSERC/PAY/2026/09003";
  wb.getWorksheet("Payments")!.getCell("C7").value = ACK;
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "workbook-e2e.xlsx");
  await wb.xlsx.writeFile(file);
  return file;
}

test.describe.serial("Phase 7: daily review, audit log, export, import, verification", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("Run now runs the daily review and the dashboard shows when it last ran", async ({
    page,
  }) => {
    const panel = page.getByRole("region", { name: "Daily review" });
    await panel.getByRole("button", { name: "Run now" }).click();
    await expect(panel.getByText(/^Daily review done:/)).toBeVisible();
    await page.reload();
    await expect(panel).toContainText(/Last run .* by /);
    await expect(panel).toContainText("Provisional today:");
  });

  test("the audit log lists and filters entries and exports CSV", async ({ page }) => {
    await page.getByRole("link", { name: "Audit log" }).click();
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
    await page.getByLabel("Action").selectOption("Daily review");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/action=Daily\+review/);
    await expect(page.getByRole("row", { name: /Daily review/ }).first()).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^ogserc-audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await readFile((await file.path())!, "utf8");
    expect(text).toMatch(/^﻿Entry,Time \(Lagos\),User,User email,Action,Reference,Detail\r\n/);
    expect(text).toContain("Daily review");
  });

  test("the Register exports to Excel and CSV with the filters applied", async ({ page }) => {
    await page.goto("/submissions?status=Registered");
    const xlsx = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export Excel" }).click();
    expect((await xlsx).suggestedFilename()).toMatch(/^ogserc-register-.*\.xlsx$/);

    const csv = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const text = await readFile((await (await csv).path())!, "utf8");
    expect(text.split("\r\n")[0]).toMatch(/^﻿Acknowledgement No\.,Registered Name,/);
  });

  test("an Admin uploads the workbook, reviews the preview and imports it", async ({
    page,
  }, testInfo) => {
    // Upload, preview and import each run a server action over the whole workbook.
    test.setTimeout(180_000);
    const file = await workbookFile(testInfo.outputDir);
    await page.goto("/admin");
    await page.getByRole("link", { name: /Import from the workbook/ }).click();
    await page.getByLabel("Workbook file").setInputFiles(file);
    await page.getByRole("button", { name: "Upload and check" }).click();

    // Reading the workbook is slow on a cold dev server.
    await expect(page.getByRole("heading", { name: "workbook-e2e.xlsx" })).toBeVisible({
      timeout: 60_000,
    });
    const summary = page.getByRole("region", { name: "Summary" });
    await expect(summary).toContainText("Submissions1");
    await expect(summary).toContainText("Payments1");
    await expect(page.getByRole("region", { name: "Warnings" })).toContainText(
      'CAC number "1234567899" is not RC/BN/IT + digits',
    );
    await expect(page.getByRole("region", { name: "Submissions to import" })).toContainText(REG);

    const importButton = page.getByRole("button", { name: /^Import 1 submissions/ });
    await page.getByLabel(/I have checked the warnings/).check();
    await importButton.click();
    // The page refreshes into its imported state: the banner replaces the form.
    await expect(page.getByRole("status")).toContainText(
      /Imported .* by .*: 1 submissions, 0 own-use notifications, 1 payments/,
    );
    await expect(importButton).toHaveCount(0);

    await page.goto(`/submissions?q=${encodeURIComponent(ACK)}`);
    await page.getByRole("link", { name: ACK }).click();
    await expect(page.getByText(REG).first()).toBeVisible();
  });

  test("the verification page shows the registration's current state", async ({ page }) => {
    await page.goto(`/submissions?q=${encodeURIComponent(ACK)}`);
    const href = await page.getByRole("link", { name: ACK }).getAttribute("href");
    const id = href!.split("/").pop();
    await page.goto(`/verify/${id}`);
    await expect(page.getByRole("status")).toContainText("Registered");
    await expect(page.getByText(REG)).toBeVisible();
    await expect(page.getByText("No certificate has been issued in this system.")).toBeVisible();
  });
});
