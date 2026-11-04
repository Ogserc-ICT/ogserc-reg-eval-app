// Compares verify-workbook.ps1 results with the expected values from fixtures.ts (the domain
// functions). Prints a report, writes it as Markdown, and exits 1 on any mismatch or skipped check.
//
//   tsx scripts/workbook/compare.ts <fixtures.json> <results.json> <report.md>

import { readFileSync, writeFileSync } from "node:fs";

type Val = string | number | boolean | null;
interface Result {
  fixture: string;
  spec: string;
  title: string;
  kind: "value" | "audit" | "message" | "skipped" | "error";
  label?: string;
  column?: string;
  expected?: Val | Val[];
  actual?: Val | Val[];
  reason?: string;
}

const read = (p: string) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
const [fixturesPath, resultsPath, reportPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const formulasOnly = process.argv.includes("--formulas-only");
if (!fixturesPath || !resultsPath || !reportPath) throw new Error("Usage: compare.ts <fixtures.json> <results.json> <report.md>");
const fx = read(fixturesPath) as { fixtures: { id: string; spec: string; title: string; macros: boolean }[]; notApplicable: { spec: string; reason: string }[] };
const res = read(resultsPath) as { macrosAvailable: boolean; results: Result[] | Result };
const results = Array.isArray(res.results) ? res.results : [res.results];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const oaToIso = (n: number) => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
const asList = (v: unknown): string[] => (v === null || v === undefined ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);

function same(expected: Val, actual: Val): boolean {
  const e = expected ?? "";
  const a = actual ?? "";
  if (typeof e === "string" && ISO.test(e) && typeof a === "number") return oaToIso(a) === e;
  if (typeof e === "number") return typeof a === "number" ? Math.abs(a - e) < 0.005 : String(a) === String(e);
  if (typeof a === "number") return String(e) === String(a) || (e !== "" && Math.abs(Number(e) - a) < 0.005);
  return String(e).replace(/\r\n/g, "\n") === String(a).replace(/\r\n/g, "\n");
}
const show = (v: unknown, e?: unknown) =>
  typeof e === "string" && ISO.test(e) && typeof v === "number" ? oaToIso(v) : JSON.stringify(v ?? "");

const failures: string[] = [];
const byFixture = new Map<string, { checks: number; failed: number }>();
const tally = (id: string, ok: boolean) => {
  const t = byFixture.get(id) ?? { checks: 0, failed: 0 };
  t.checks++;
  if (!ok) t.failed++;
  byFixture.set(id, t);
};

for (const r of results) {
  const where = `${r.fixture} › ${r.label ?? ""}`;
  switch (r.kind) {
    case "value": {
      const ok = same(r.expected as Val, r.actual as Val);
      tally(r.fixture, ok);
      if (!ok) failures.push(`${where} › ${r.column}: expected ${show(r.expected)} but the workbook shows ${show(r.actual, r.expected)}`);
      break;
    }
    case "audit": {
      const e = asList(r.expected);
      const a = asList(r.actual);
      // Expected actions must appear in order (other entries may come between them).
      let i = 0;
      for (const act of a) if (i < e.length && act === e[i]) i++;
      const ok = i === e.length;
      tally(r.fixture, ok);
      if (!ok) failures.push(`${where}: audit entries expected ${JSON.stringify(e)} in order, found ${JSON.stringify(a)}`);
      break;
    }
    case "message": {
      const text = String(r.actual ?? "");
      const missing = asList(r.expected).filter((m) => !text.includes(m));
      tally(r.fixture, missing.length === 0);
      if (missing.length) failures.push(`${where}: message lacks ${JSON.stringify(missing)}; it said ${JSON.stringify(text)}`);
      break;
    }
    case "skipped":
      if (formulasOnly) break;
      tally(r.fixture, false);
      failures.push(`${r.fixture}: skipped (${r.reason})`);
      break;
    case "error":
      tally(r.fixture, false);
      failures.push(`${r.fixture}: error while entering the fixture: ${r.reason}`);
      break;
  }
}

const lines: string[] = [];
lines.push(`# Workbook verification`, ``, `Generated ${new Date().toISOString()}. Macros ${res.macrosAvailable ? "imported" : "NOT imported"}.`, ``);
lines.push(`| SPEC §11 row | Fixture | Checks | Result |`, `|---|---|---|---|`);
for (const f of fx.fixtures) {
  const t = byFixture.get(f.id);
  const status = !t ? "not run" : t.failed ? `**${t.failed} failed**` : "match";
  lines.push(`| ${f.spec} | ${f.title} | ${t?.checks ?? 0} | ${status} |`);
}
for (const n of fx.notApplicable) lines.push(`| ${n.spec} | not applicable: ${n.reason} | – | n/a |`);
lines.push(``, failures.length ? `## Mismatches (${failures.length})` : `## All fixtures match the domain functions`, ``);
for (const f of failures) lines.push(`- ${f}`);
writeFileSync(reportPath, lines.join("\n") + "\n", "utf8");

const total = [...byFixture.values()].reduce((s, t) => s + t.checks, 0);
console.log(`${fx.fixtures.length} fixtures, ${total} checks, ${failures.length} problem(s). Report: ${reportPath}`);
for (const f of failures.slice(0, 80)) console.log("  ✗ " + f);
if (failures.length > 80) console.log(`  … and ${failures.length - 80} more`);
process.exit(failures.length ? 1 : 0);
