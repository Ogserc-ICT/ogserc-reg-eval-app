"use client";

import { inputClass } from "@/components/form";
import {
  type Cell,
  type FieldValue,
  type FormAnswers,
  type TechColumn,
  type TechField,
  type TechSection,
  type TechnicalData,
  type TechnicalDefs,
} from "@/domain/technical";

const EMPTY: FormAnswers = { notApplicable: [], sections: {} };
const total = (n: number) => n.toLocaleString("en-NG", { maximumFractionDigits: 3 });
const num = (c: Cell) => {
  const n = typeof c === "number" ? c : Number(String(c ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && String(c ?? "").trim() !== "" ? n : 0;
};

function CellInput({
  column,
  value,
  onChange,
  label,
}: {
  column: Pick<TechColumn, "type" | "options">;
  value: Cell;
  onChange: (v: string) => void;
  label: string;
}) {
  const v = value === null || value === undefined ? "" : String(value);
  if (column.type === "select") {
    return (
      <select
        aria-label={label}
        value={v}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      >
        <option value="">—</option>
        {column.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={label}
      value={v}
      onChange={(e) => onChange(e.target.value)}
      type={column.type === "date" ? "date" : "text"}
      inputMode={["number", "integer", "money"].includes(column.type) ? "decimal" : undefined}
      className={inputClass}
    />
  );
}

/** Totals row under a table or grid, for the columns that are summed. */
function TotalsRow({
  field,
  value,
  lead,
}: {
  field: TechField;
  value: FieldValue | undefined;
  lead: number;
}) {
  if (!field.columns?.some((c) => c.sum)) return null;
  const rows: Record<string, Cell>[] = Array.isArray(value)
    ? (value as Record<string, Cell>[])
    : Object.values((value ?? {}) as Record<string, Record<string, Cell>>);
  // Totals of what is typed now.
  const totals = Object.fromEntries(
    field.columns
      .filter((c) => c.sum)
      .map((c) => [c.key, rows.reduce((t, r) => t + num(r[c.key] ?? null), 0)]),
  );
  return (
    <tr className="font-medium">
      <td colSpan={lead} className="py-1 pr-2 text-xs text-gray-600">
        Total
      </td>
      {field.columns.map((c) => (
        <td key={c.key} className="px-1 py-1 text-right text-xs">
          {c.sum ? total(totals[c.key] ?? 0) : ""}
        </td>
      ))}
      {field.rowTotal && <td />}
    </tr>
  );
}

function FieldInput({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: TechField;
  value: FieldValue | undefined;
  onChange: (v: FieldValue) => void;
}) {
  const label = `${field.label}${field.unit ? ` (${field.unit})` : ""}`;
  switch (field.type) {
    case "checks": {
      const picked = (value as string[] | undefined) ?? [];
      return (
        <fieldset className="sm:col-span-2 lg:col-span-3">
          <legend className="mb-1 text-sm font-medium text-gray-800">{field.label}</legend>
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {field.options!.map((o) => (
              <label key={o.value} className="flex items-start gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={picked.includes(o.value)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? field
                            .options!.map((x) => x.value)
                            .filter((x) => x === o.value || picked.includes(x))
                        : picked.filter((x) => x !== o.value),
                    )
                  }
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    case "choice":
      return (
        <div>
          <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-800">
            {field.label}
          </label>
          <select
            id={id}
            value={(value as string | null) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {field.options!.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      );
    case "textarea":
      return (
        <div className="sm:col-span-2 lg:col-span-3">
          <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-800">
            {label}
          </label>
          <textarea
            id={id}
            rows={2}
            value={(value as string | null) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
          />
        </div>
      );
    case "table": {
      const rows = (value as Record<string, Cell>[] | undefined) ?? [];
      const fixed = field.fixedRows;
      const shown = fixed ? Array.from({ length: fixed }, (_, i) => rows[i] ?? {}) : rows;
      const setCell = (i: number, key: string, v: string) => {
        const next = [...shown.map((r) => ({ ...r }))];
        next[i] = { ...next[i], [key]: v };
        onChange(next);
      };
      return (
        <div className="overflow-x-auto sm:col-span-2 lg:col-span-3">
          <p className="mb-1 text-sm font-medium text-gray-800">{field.label}</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-600">
              <tr>
                {fixed && <th className="py-1 pr-2 font-normal">#</th>}
                {field.columns!.map((c) => (
                  <th key={c.key} className="px-1 py-1 font-normal">
                    {c.label}
                  </th>
                ))}
                {!fixed && <th />}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, i) => (
                <tr key={i}>
                  {fixed && <td className="py-0.5 pr-2 text-xs text-gray-500">{i + 1}</td>}
                  {field.columns!.map((c) => (
                    <td key={c.key} className="px-1 py-0.5">
                      <CellInput
                        column={c}
                        value={row[c.key] ?? null}
                        label={`${c.label}, row ${i + 1}`}
                        onChange={(v) => setCell(i, c.key, v)}
                      />
                    </td>
                  ))}
                  {!fixed && (
                    <td className="px-1">
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                        aria-label={`Remove ${field.label} row ${i + 1}`}
                        onClick={() => onChange(rows.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <TotalsRow field={field} value={shown} lead={fixed ? 1 : 0} />
            </tfoot>
          </table>
          {!fixed && (
            <button
              type="button"
              onClick={() => onChange([...rows, {}])}
              className="border-brand-600 text-brand-800 hover:bg-brand-50 mt-1.5 rounded border px-2.5 py-1 text-xs font-medium"
            >
              + Add row: {field.label}
            </button>
          )}
        </div>
      );
    }
    case "grid": {
      const g = (value as Record<string, Record<string, Cell>> | undefined) ?? {};
      const setCell = (row: string, key: string, v: string) =>
        onChange({ ...g, [row]: { ...g[row], [key]: v } });
      const summed = field.columns!.filter((c) => c.sum);
      return (
        <div className="overflow-x-auto sm:col-span-2 lg:col-span-3">
          <p className="mb-1 text-sm font-medium text-gray-800">{field.label}</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-600">
              <tr>
                <th className="py-1 pr-2 font-normal" />
                {field.columns!.map((c) => (
                  <th key={c.key} className="px-1 py-1 font-normal">
                    {c.label}
                  </th>
                ))}
                {field.rowTotal && <th className="px-1 py-1 text-right font-normal">Total</th>}
              </tr>
            </thead>
            <tbody>
              {field.rows!.map((r) => (
                <tr key={r.key}>
                  <th scope="row" className="py-0.5 pr-2 text-left text-xs font-normal">
                    {r.label}
                  </th>
                  {field.columns!.map((c) => (
                    <td key={c.key} className="px-1 py-0.5">
                      <CellInput
                        column={c}
                        value={g[r.key]?.[c.key] ?? null}
                        label={`${r.label}: ${c.label}`}
                        onChange={(v) => setCell(r.key, c.key, v)}
                      />
                    </td>
                  ))}
                  {field.rowTotal && (
                    <td className="px-1 text-right text-xs">
                      {total(summed.reduce((t, c) => t + num(g[r.key]?.[c.key] ?? null), 0))}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <TotalsRow field={field} value={g} lead={1} />
            </tfoot>
          </table>
        </div>
      );
    }
    default:
      return (
        <div>
          <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-800">
            {label}
          </label>
          <input
            id={id}
            value={(value as string | number | null) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            type={field.type === "date" ? "date" : "text"}
            inputMode={["number", "integer", "money"].includes(field.type) ? "decimal" : undefined}
            className={inputClass}
          />
        </div>
      );
  }
}

function SectionBlock({
  form,
  section,
  answers,
  onChange,
}: {
  form: string;
  section: TechSection;
  answers: FormAnswers;
  onChange: (next: FormAnswers) => void;
}) {
  const na = answers.notApplicable.includes(section.key);
  const values = answers.sections[section.key] ?? {};
  return (
    <fieldset className="rounded border border-gray-200 p-3">
      <legend className="text-brand-800 px-1 text-sm font-semibold">{section.title}</legend>
      <label className="mb-2 flex items-center gap-1.5 text-xs text-gray-700">
        <input
          type="checkbox"
          checked={na}
          onChange={(e) =>
            onChange({
              ...answers,
              notApplicable: e.target.checked
                ? [...answers.notApplicable, section.key]
                : answers.notApplicable.filter((k) => k !== section.key),
            })
          }
        />
        Does not apply
      </label>
      {!na && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {section.fields.map((f) => (
            <FieldInput
              key={f.key}
              id={`tech-${form}-${section.key}-${f.key}`}
              field={f}
              value={values[f.key]}
              onChange={(v) =>
                onChange({
                  ...answers,
                  sections: { ...answers.sections, [section.key]: { ...values, [f.key]: v } },
                })
              }
            />
          ))}
          {section.note && (
            <p className="text-xs text-gray-600 sm:col-span-2 lg:col-span-3">{section.note}</p>
          )}
        </div>
      )}
    </fieldset>
  );
}

/**
 * The category-specific sections of the forms shown (the form filed first, then each other
 * activity's form), folded and optional. Answers for forms not shown are kept as they are.
 */
export function TechnicalSections({
  defs,
  forms,
  titles,
  value,
  onChange,
  errors,
}: {
  defs: TechnicalDefs;
  forms: string[];
  titles: Record<string, string>;
  value: TechnicalData;
  onChange: (next: TechnicalData) => void;
  errors?: string[];
}) {
  return (
    <div className="space-y-3">
      {errors?.length ? (
        <ul role="alert" className="ml-5 list-disc text-xs text-red-700">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {forms.map((form, i) => {
        const def = defs[form];
        if (!def) return null;
        const answers = value[form] ?? EMPTY;
        const filled = Object.keys(answers.sections).length + answers.notApplicable.length;
        return (
          <details key={form} open={filled > 0} className="rounded border border-gray-200 bg-white">
            <summary className="text-brand-800 cursor-pointer px-4 py-2.5 text-sm font-semibold">
              {form} — {titles[form] ?? ""}: category-specific sections{" "}
              <span className="font-normal text-gray-500">
                ({i === 0 ? "form filed" : "other activity"}; optional)
              </span>
            </summary>
            <div className="space-y-3 px-4 pb-4">
              {def.sections.map((s) => (
                <SectionBlock
                  key={s.key}
                  form={form}
                  section={s}
                  answers={answers}
                  onChange={(next) => onChange({ ...value, [form]: next })}
                />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
