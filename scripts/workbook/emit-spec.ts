// Writes the workbook spec as JSON for build-workbook.ps1: tsx scripts/workbook/emit-spec.ts <out.json>
import { writeFileSync } from "node:fs";
import { buildSpec } from "./spec";

const out = process.argv[2];
if (!out) throw new Error("Usage: emit-spec.ts <out.json>");
writeFileSync(out, JSON.stringify(buildSpec(), null, 1), "utf8");
console.log(`Spec written to ${out}`);
