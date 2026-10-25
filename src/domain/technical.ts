// Category-specific ("technical") sections of Forms REG-01A to REG-01K, defined in
// technical-sections.json: sections of fields, tables and fixed grids. Answers are stored per form
// filed or activity form, validated here, and drive document conditions and data flags.

import type { FieldChange } from "./filing";
import { CONDITION_KEYS, type ConditionKey, type Conditions } from "./forms";
import { formatNaira, parseNairaToKobo } from "./money";
import { isIsoDate } from "./dates";

export type ColumnType = "text" | "number" | "integer" | "money" | "select" | "date";
export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "integer"
  | "money"
  | "date"
  | "checks"
  | "choice"
  | "table"
  | "grid";

export interface TechOption {
  value: string;
  label: string;
}

export interface TechColumn {
  key: string;
  label: string;
  type: ColumnType;
  unit?: string;
  options?: TechOption[];
  /** Show a total under the column. */
  sum?: boolean;
  /** The column's total is an installed capacity (compared with the submission's). */
  capacity?: "MW" | "kW";
}

export interface TechField {
  key: string;
  label: string;
  type: FieldType;
  unit?: string;
  options?: TechOption[];
  /** Not needed for the section to count as complete. */
  optional?: boolean;
  /** A number field that states an installed capacity. */
  capacity?: "MW" | "kW";
  /** A checks or choice field whose answer decides a document condition: Y if any `yes` value. */
  derive?: { condition: ConditionKey; yes: string[] };
  /** Table and grid columns. */
  columns?: TechColumn[];
  /** Grid: fixed rows (e.g. customer classes). */
  rows?: { key: string; label: string }[];
  /** Grid: show a total per row (sum of the summed columns). */
  rowTotal?: boolean;
  /** Table: a fixed number of rows (e.g. the 12 months). */
  fixedRows?: number;
}

export interface TechSection {
  key: string;
  title: string;
  fields: TechField[];
  note?: string;
  /** Only applies when this condition is Y (e.g. the multi-State section of REG-01A). */
  appliesWhen?: ConditionKey;
  /** The section itself decides a condition: Y once answered, N when marked "does not apply". */
  derive?: ConditionKey;
}

export type TechnicalDefs = Record<string, { sections: TechSection[] }>;

/** A table or grid cell. Money is integer kobo; numbers are as entered in the field's unit. */
export type Cell = string | number | null;
export type FieldValue =
  Cell | string[] | Record<string, Cell>[] | Record<string, Record<string, Cell>>;

export interface FormAnswers {
  /** Sections the applicant marked "does not apply". */
  notApplicable: string[];
  /** Section key → field key → value. */
  sections: Record<string, Record<string, FieldValue>>;
}

/** Form code → answers. Answers for forms not currently shown are kept. */
export type TechnicalData = Record<string, FormAnswers>;

export const NO_ANSWERS: FormAnswers = { notApplicable: [], sections: {} };

// --- Parsing and validation ---------------------------------------------------------------------

const isEmpty = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

function parseNumber(v: unknown, integer: boolean): number | null | "invalid" {
  if (isEmpty(v)) return null;
  const s = String(v).trim().replace(/,/g, "");
  if (!(integer ? /^\d+$/ : /^-?\d+(\.\d+)?$/).test(s)) return "invalid";
  return Number(s);
}

function parseCell(
  type: ColumnType | FieldType,
  v: unknown,
  options: TechOption[] | undefined,
): Cell | "invalid" {
  if (isEmpty(v)) return null;
  switch (type) {
    case "number":
      return parseNumber(v, false);
    case "integer":
      return parseNumber(v, true);
    case "money": {
      if (typeof v === "number") return Number.isInteger(v) ? v : "invalid";
      return parseNairaToKobo(String(v)) ?? "invalid";
    }
    case "date":
      return isIsoDate(String(v).trim()) ? String(v).trim() : "invalid";
    case "select":
    case "choice":
      return options?.some((o) => o.value === v) ? String(v) : "invalid";
    default:
      return String(v).trim().slice(0, 2000);
  }
}

const TYPE_ERROR: Partial<Record<ColumnType | FieldType, string>> = {
  number: "must be a number",
  integer: "must be a whole number",
  money: "must be an amount in naira",
  date: "must be a date (YYYY-MM-DD)",
  select: "must be one of the choices",
  choice: "must be one of the choices",
};

const rowHasValue = (row: Record<string, Cell>) => Object.values(row).some((c) => !isEmpty(c));

/**
 * Keep only the forms, sections and fields the definitions know, with every value converted to its
 * type. Blank table rows are dropped. Returns every problem, worded for the form.
 */
export function parseTechnical(
  defs: TechnicalDefs,
  raw: unknown,
): { data: TechnicalData; errors: string[] } {
  const data: TechnicalData = {};
  const errors: string[] = [];
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  for (const [form, def] of Object.entries(defs)) {
    const given = input[form] as Partial<Record<keyof FormAnswers, unknown>> | undefined;
    if (!given || typeof given !== "object") continue;
    const sectionKeys = new Set(def.sections.map((s) => s.key));
    const notApplicable = Array.isArray(given.notApplicable)
      ? [...new Set(given.notApplicable.map(String).filter((k) => sectionKeys.has(k)))]
      : [];
    const out: FormAnswers = { notApplicable, sections: {} };
    const sectionsIn = (given.sections ?? {}) as Record<string, Record<string, unknown>>;
    for (const section of def.sections) {
      const values = sectionsIn[section.key];
      if (!values || typeof values !== "object") continue;
      const kept: Record<string, FieldValue> = {};
      for (const f of section.fields) {
        const where = `${form} ${section.title}: ${f.label}`;
        const v = values[f.key];
        if (f.type === "checks") {
          const picked = Array.isArray(v) ? v.map(String) : [];
          const bad = picked.filter((p) => !f.options?.some((o) => o.value === p));
          if (bad.length) errors.push(`${where}: not one of the choices`);
          const ok = f.options!.map((o) => o.value).filter((o) => picked.includes(o));
          if (ok.length) kept[f.key] = ok;
        } else if (f.type === "table") {
          const rows = Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
          const parsed: Record<string, Cell>[] = [];
          rows.slice(0, f.fixedRows ?? 200).forEach((row, i) => {
            const cells: Record<string, Cell> = {};
            for (const c of f.columns!) {
              const cell = parseCell(c.type, row?.[c.key], c.options);
              if (cell === "invalid") {
                errors.push(`${where}, row ${i + 1}: ${c.label} ${TYPE_ERROR[c.type]}`);
                cells[c.key] = null;
              } else cells[c.key] = cell;
            }
            if (rowHasValue(cells)) parsed.push(cells);
          });
          if (parsed.length) kept[f.key] = parsed;
        } else if (f.type === "grid") {
          const given = (v && typeof v === "object" ? v : {}) as Record<
            string,
            Record<string, unknown>
          >;
          const parsed: Record<string, Record<string, Cell>> = {};
          for (const r of f.rows!) {
            const cells: Record<string, Cell> = {};
            for (const c of f.columns!) {
              const cell = parseCell(c.type, given[r.key]?.[c.key], c.options);
              if (cell === "invalid") {
                errors.push(`${where}, ${r.label}: ${c.label} ${TYPE_ERROR[c.type]}`);
                cells[c.key] = null;
              } else cells[c.key] = cell;
            }
            if (rowHasValue(cells)) parsed[r.key] = cells;
          }
          if (Object.keys(parsed).length) kept[f.key] = parsed;
        } else {
          const cell = parseCell(f.type, v, f.options);
          if (cell === "invalid") errors.push(`${where} ${TYPE_ERROR[f.type]}`);
          else if (cell !== null) kept[f.key] = cell;
        }
      }
      if (Object.keys(kept).length) out.sections[section.key] = kept;
    }
    if (out.notApplicable.length || Object.keys(out.sections).length) data[form] = out;
  }
  return { data, errors };
}

// --- Completeness --------------------------------------------------------------------------------

export type SectionStatus = "complete" | "incomplete" | "empty" | "not-applicable" | "not-required";

const answered = (v: FieldValue | undefined) =>
  !(v === undefined || v === null || (Array.isArray(v) && v.length === 0) || v === "");

/**
 * A section is complete when every field that is not optional is answered (a table or grid: at least
 * one row). "Does not apply" sections, and sections whose condition is N, are not counted.
 */
export function sectionStatus(
  section: TechSection,
  answers: FormAnswers,
  conditions: Conditions,
): SectionStatus {
  if (section.appliesWhen && conditions[section.appliesWhen] === "N") return "not-required";
  if (answers.notApplicable.includes(section.key)) return "not-applicable";
  const values = answers.sections[section.key] ?? {};
  const required = section.fields.filter((f) => !f.optional);
  const done = required.filter((f) => answered(values[f.key])).length;
  if (!Object.values(values).some(answered)) return "empty";
  return done === required.length ? "complete" : "incomplete";
}

export interface FormProgress {
  form: string;
  sections: { key: string; title: string; status: SectionStatus }[];
  /** Titles of the sections still to fill in (empty or incomplete). */
  outstanding: string[];
}

export function formProgress(
  form: string,
  defs: TechnicalDefs,
  data: TechnicalData,
  conditions: Conditions,
): FormProgress | null {
  const def = defs[form];
  if (!def) return null;
  const answers = data[form] ?? NO_ANSWERS;
  const sections = def.sections.map((s) => ({
    key: s.key,
    title: s.title,
    status: sectionStatus(s, answers, conditions),
  }));
  return {
    form,
    sections,
    outstanding: sections
      .filter((s) => s.status === "empty" || s.status === "incomplete")
      .map((s) => s.title),
  };
}

// --- Conditions ---------------------------------------------------------------------------------

/**
 * Document conditions that the technical answers decide, over the given forms. Unanswered → no
 * value (the stored yes/no, if any, applies). When two forms disagree, Y wins: a document that
 * applies to one activity is needed.
 */
export function derivedConditions(
  defs: TechnicalDefs,
  data: TechnicalData,
  forms: readonly string[],
): Partial<Conditions> {
  const out: Partial<Conditions> = {};
  const set = (k: ConditionKey, v: "Y" | "N") => {
    if (out[k] !== "Y") out[k] = v;
  };
  for (const form of forms) {
    const def = defs[form];
    if (!def) continue;
    const answers = data[form] ?? NO_ANSWERS;
    for (const s of def.sections) {
      const values = answers.sections[s.key] ?? {};
      if (s.derive) {
        if (answers.notApplicable.includes(s.key)) set(s.derive, "N");
        else if (Object.values(values).some(answered)) set(s.derive, "Y");
      }
      for (const f of s.fields) {
        if (!f.derive) continue;
        const v = values[f.key];
        if (!answered(v)) continue;
        const picked = Array.isArray(v) ? (v as string[]) : [String(v)];
        set(f.derive.condition, picked.some((p) => f.derive!.yes.includes(p)) ? "Y" : "N");
      }
    }
  }
  return out;
}

/** Conditions that some field or section of these forms decides (their yes/no question is hidden). */
export function conditionsDecidedBy(defs: TechnicalDefs, forms: readonly string[]): ConditionKey[] {
  const keys = new Set<ConditionKey>();
  for (const form of forms) {
    for (const s of defs[form]?.sections ?? []) {
      if (s.derive) keys.add(s.derive);
      for (const f of s.fields) if (f.derive) keys.add(f.derive.condition);
    }
  }
  return CONDITION_KEYS.filter((k) => keys.has(k));
}

// --- Capacity ------------------------------------------------------------------------------------

const toMw = (value: number, unit: "MW" | "kW") => (unit === "kW" ? value / 1000 : value);

/** Every installed capacity the technical sections state, in MW (a field, or a column total). */
export function declaredCapacities(
  defs: TechnicalDefs,
  data: TechnicalData,
  forms: readonly string[],
): { form: string; label: string; mw: number }[] {
  const out: { form: string; label: string; mw: number }[] = [];
  for (const form of forms) {
    const answers = data[form];
    if (!answers) continue;
    for (const s of defs[form]?.sections ?? []) {
      const values = answers.sections[s.key] ?? {};
      for (const f of s.fields) {
        const v = values[f.key];
        if (f.capacity && typeof v === "number") {
          out.push({ form, label: `${s.title}: ${f.label}`, mw: toMw(v, f.capacity) });
        }
        if (f.type === "table" && Array.isArray(v)) {
          for (const c of f.columns ?? []) {
            if (!c.capacity) continue;
            const nums = (v as Record<string, Cell>[])
              .map((r) => r[c.key])
              .filter((n) => typeof n === "number");
            if (nums.length) {
              const total = (nums as number[]).reduce((a, b) => a + b, 0);
              out.push({
                form,
                label: `${s.title}: total ${c.label}`,
                mw: toMw(total, c.capacity),
              });
            }
          }
        }
      }
    }
  }
  return out;
}

/** Same capacity, allowing for rounding: within 1% (and 1 kW). */
export function capacitiesAgree(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.001, 0.01 * Math.max(Math.abs(a), Math.abs(b)));
}

// --- Totals and text -----------------------------------------------------------------------------

/** Totals of the summed columns of a table, or of a grid's rows. */
export function columnTotals(
  field: TechField,
  value: FieldValue | undefined,
): Record<string, number> {
  const rows: Record<string, Cell>[] = Array.isArray(value)
    ? (value as Record<string, Cell>[])
    : value && typeof value === "object"
      ? Object.values(value as Record<string, Record<string, Cell>>)
      : [];
  const totals: Record<string, number> = {};
  for (const c of field.columns ?? []) {
    if (!c.sum) continue;
    totals[c.key] = rows.reduce(
      (t, r) => t + (typeof r[c.key] === "number" ? (r[c.key] as number) : 0),
      0,
    );
  }
  return totals;
}

function cellText(
  type: ColumnType | FieldType,
  v: Cell,
  options?: TechOption[],
  unit?: string,
): string {
  if (v === null || v === "") return "";
  if (type === "money" && typeof v === "number") return formatNaira(v);
  if ((type === "select" || type === "choice") && options) {
    return options.find((o) => o.value === v)?.label ?? String(v);
  }
  if (typeof v === "number") {
    const n = v.toLocaleString("en-NG", { maximumFractionDigits: 3 });
    return unit && !["%"].includes(unit) ? `${n} ${unit}` : unit === "%" ? `${n}%` : n;
  }
  return String(v);
}

/** One field's answer as one line of text (for the record page, audit entries and updates). */
export function fieldText(f: TechField, v: FieldValue | undefined): string | null {
  if (!answered(v)) return null;
  if (f.type === "checks") {
    return (v as string[]).map((p) => f.options?.find((o) => o.value === p)?.label ?? p).join("; ");
  }
  if (f.type === "table") {
    return (v as Record<string, Cell>[])
      .map((row) =>
        f
          .columns!.map((c) => cellText(c.type, row[c.key] ?? null, c.options, c.unit))
          .filter(Boolean)
          .join(", "),
      )
      .join(" | ");
  }
  if (f.type === "grid") {
    const g = v as Record<string, Record<string, Cell>>;
    return f
      .rows!.filter((r) => g[r.key])
      .map(
        (r) =>
          `${r.label}: ${f
            .columns!.map((c) => {
              const t = cellText(c.type, g[r.key]![c.key] ?? null, c.options, c.unit);
              return t ? `${c.label} ${t}` : "";
            })
            .filter(Boolean)
            .join(", ")}`,
      )
      .join(" | ");
  }
  return cellText(f.type, v as Cell, f.options, f.unit) || null;
}

/** What differs between two sets of answers, field by field (for audit entries and updates). */
export function technicalChanges(
  defs: TechnicalDefs,
  before: TechnicalData,
  after: TechnicalData,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [form, def] of Object.entries(defs)) {
    const a = before[form] ?? NO_ANSWERS;
    const b = after[form] ?? NO_ANSWERS;
    for (const s of def.sections) {
      const naBefore = a.notApplicable.includes(s.key);
      const naAfter = b.notApplicable.includes(s.key);
      if (naBefore !== naAfter) {
        changes.push({
          key: `technical:${form}:${s.key}`,
          label: `${form} ${s.title}`,
          before: naBefore ? "does not apply" : null,
          after: naAfter ? "does not apply" : null,
          certificate: false,
        });
      }
      for (const f of s.fields) {
        const x = fieldText(f, a.sections[s.key]?.[f.key]);
        const y = fieldText(f, b.sections[s.key]?.[f.key]);
        if (x !== y) {
          changes.push({
            key: `technical:${form}:${s.key}:${f.key}`,
            label: `${form} ${s.title}: ${f.label}`,
            before: x,
            after: y,
            certificate: false,
          });
        }
      }
    }
  }
  return changes;
}

/**
 * Stored answers as the form edits them: money from kobo to naira, numbers as text. (The form posts
 * text back; `parseTechnical` converts it again.)
 */
export function technicalForEditing(defs: TechnicalDefs, data: TechnicalData): TechnicalData {
  const asText = (type: ColumnType | FieldType, v: Cell): Cell => {
    if (v === null) return null;
    if (type === "money" && typeof v === "number") return String(v / 100);
    return typeof v === "number" ? String(v) : v;
  };
  const out: TechnicalData = {};
  for (const [form, answers] of Object.entries(data)) {
    const def = defs[form];
    if (!def) continue;
    const sections: FormAnswers["sections"] = {};
    for (const s of def.sections) {
      const values = answers.sections?.[s.key];
      if (!values) continue;
      const kept: Record<string, FieldValue> = {};
      for (const f of s.fields) {
        const v = values[f.key];
        if (v === undefined) continue;
        if (f.type === "table" && Array.isArray(v)) {
          kept[f.key] = (v as Record<string, Cell>[]).map((r) =>
            Object.fromEntries(f.columns!.map((c) => [c.key, asText(c.type, r[c.key] ?? null)])),
          );
        } else if (f.type === "grid" && v && typeof v === "object" && !Array.isArray(v)) {
          kept[f.key] = Object.fromEntries(
            Object.entries(v as Record<string, Record<string, Cell>>).map(([row, cells]) => [
              row,
              Object.fromEntries(
                f.columns!.map((c) => [c.key, asText(c.type, cells[c.key] ?? null)]),
              ),
            ]),
          );
        } else if (f.type === "checks") kept[f.key] = v;
        else kept[f.key] = asText(f.type, v as Cell);
      }
      sections[s.key] = kept;
    }
    out[form] = { notApplicable: answers.notApplicable ?? [], sections };
  }
  return out;
}
