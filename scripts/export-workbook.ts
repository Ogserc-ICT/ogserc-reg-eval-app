// npm run export:workbook — rebuilds exports/OGSERC_Registration_and_Evaluation_System_v2.xlsm from
// src/domain/ and the seed files, then checks every SPEC §11 fixture against the domain functions.
// The workbook is copied to exports/ only if every check matches.
//
// Windows with Excel only. Importing the macros needs Excel's "Trust access to the VBA project object
// model" (File > Options > Trust Center > Trust Center Settings > Macro Settings). This script never
// changes that setting. Options:
//   --formulas-only   build and verify without macros (.xlsx in exports/.build; nothing delivered)

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildSpec } from "./workbook/spec";

const root = resolve(__dirname, "..");
const build = join(root, "exports", ".build");
const finalPath = join(root, "exports", "OGSERC_Registration_and_Evaluation_System_v2.xlsm");
const formulasOnly = process.argv.includes("--formulas-only");
mkdirSync(build, { recursive: true });

if (process.platform !== "win32") {
  console.error("export:workbook needs Windows with Microsoft Excel (it drives Excel through COM).");
  process.exit(1);
}

const ps = (script: string, args: string[]) => {
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts", "workbook", script), ...args], {
    stdio: "inherit",
  });
  return r.status ?? 1;
};
const tsx = (script: string, args: string[]) =>
  spawnSync(process.execPath, [join(root, "node_modules", "tsx", "dist", "cli.mjs"), join(root, "scripts", "workbook", script), ...args], { stdio: "inherit" }).status ?? 1;

let version = "unknown";
try {
  version = execFileSync("git", ["log", "-1", "--format=%h", "--", "src/domain", "seed-data.json", "registration-forms.json", "scripts/workbook"], { cwd: root }).toString().trim() || "uncommitted";
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "src/domain", "scripts/workbook"], { cwd: root }).toString().trim();
  if (dirty) version += "+local changes";
} catch {
  /* not a git checkout */
}

console.log("1/4 Writing the workbook spec and the fixtures…");
const specPath = join(build, "spec.json");
writeFileSync(specPath, JSON.stringify(buildSpec(), null, 1), "utf8");
const fixturesPath = join(build, "fixtures.json");
if (tsx("fixtures.ts", [fixturesPath]) !== 0) process.exit(1);

console.log("2/4 Building the workbook with Excel…");
const built = join(build, formulasOnly ? "formulas.xlsx" : "OGSERC_v2.xlsm");
const buildArgs = ["-Spec", specPath, "-OutPath", built, "-RulesVersion", version];
if (!formulasOnly) buildArgs.push("-VbaDir", join(root, "scripts", "workbook", "vba"));
const code = ps("build-workbook.ps1", buildArgs);
if (code === 3) {
  console.error("\nThe macros could not be imported: turn on Excel's “Trust access to the VBA project object model”, then run this again.");
  console.error("(Or run with --formulas-only to check the formulas alone; nothing is delivered then.)");
  process.exit(3);
}
if (code !== 0) process.exit(code);

console.log("3/4 Entering every SPEC §11 fixture and recalculating…");
const resultsPath = join(build, "results.json");
if (ps("verify-workbook.ps1", ["-Workbook", built, "-Fixtures", fixturesPath, "-OutPath", resultsPath]) !== 0) process.exit(1);

console.log("4/4 Comparing with the domain functions…");
const reportPath = join(root, "exports", "workbook-verification.md");
const cmp = tsx("compare.ts", [fixturesPath, resultsPath, reportPath, ...(formulasOnly ? ["--formulas-only"] : [])]);
if (cmp !== 0) {
  console.error(`\nNot delivered: the workbook does not match the domain functions. See ${reportPath}`);
  process.exit(1);
}
if (formulasOnly) {
  console.log(`\nFormulas match (macros not checked). Built file: ${built}. Nothing was delivered.`);
  process.exit(0);
}
copyFileSync(built, finalPath);
console.log(`\nDelivered ${finalPath} (rules version ${version}). Report: ${reportPath}`);
