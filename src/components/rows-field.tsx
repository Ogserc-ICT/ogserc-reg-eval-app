"use client";

import { useState } from "react";
import { inputClass } from "@/components/form";

export interface RowColumn {
  key: string;
  label: string;
  type?: "text" | "date" | "number" | "email" | "tel" | "select";
  /** For type "select". */
  options?: { value: string; label: string }[];
  /** Relative width in the row grid (default 1). */
  span?: number;
}

type Row = Record<string, string>;

function parseRows(json: string | undefined): Row[] {
  if (!json) return [];
  try {
    const rows: unknown = JSON.parse(json);
    if (!Array.isArray(rows)) return [];
    return rows.map((r) =>
      Object.fromEntries(
        Object.entries((r ?? {}) as Record<string, unknown>).map(([k, v]) => [
          k,
          v === null || v === undefined ? "" : String(v),
        ]),
      ),
    );
  } catch {
    return [];
  }
}

/**
 * An editable table of rows (licences, shareholders, generator units…). The rows travel as JSON in a
 * hidden input named `name`, so the form posts and echoes them like any other field.
 */
export function RowsField({
  name,
  label,
  columns,
  initial,
  errors,
  hint,
  addLabel = "Add row",
}: {
  name: string;
  label: string;
  columns: RowColumn[];
  /** JSON array of rows. */
  initial: string | undefined;
  errors?: Record<string, string[]>;
  hint?: React.ReactNode;
  addLabel?: string;
}) {
  const [rows, setRows] = useState<Row[]>(() => parseRows(initial));
  const empty = () => Object.fromEntries(columns.map((c) => [c.key, ""]));
  const set = (i: number, key: string, value: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const template = columns.map((c) => `${c.span ?? 1}fr`).join(" ") + " auto";
  const messages = errors?.[name];

  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <p className="mb-1 text-sm font-medium text-gray-800" id={`${name}-label`}>
        {label}
      </p>
      <input type="hidden" name={name} value={JSON.stringify(rows)} />
      {rows.length > 0 && (
        <div role="table" aria-labelledby={`${name}-label`} className="space-y-1.5">
          <div
            role="row"
            className="hidden gap-2 text-xs font-medium text-gray-600 md:grid"
            style={{ gridTemplateColumns: template }}
          >
            {columns.map((c) => (
              <span role="columnheader" key={c.key}>
                {c.label}
              </span>
            ))}
            <span />
          </div>
          {rows.map((row, i) => (
            <div
              role="row"
              key={i}
              className="grid gap-2 rounded border border-gray-100 p-1.5 md:border-0 md:p-0"
              style={{ gridTemplateColumns: template }}
            >
              {columns.map((c) => {
                const id = `${name}-${i}-${c.key}`;
                const common = {
                  id,
                  "aria-label": `${c.label}, row ${i + 1}`,
                  value: row[c.key] ?? "",
                  className: inputClass,
                };
                return (
                  <span role="cell" key={c.key}>
                    {c.type === "select" ? (
                      <select {...common} onChange={(e) => set(i, c.key, e.target.value)}>
                        <option value="">—</option>
                        {c.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        {...common}
                        type={c.type === "number" ? "text" : (c.type ?? "text")}
                        inputMode={c.type === "number" ? "decimal" : undefined}
                        onChange={(e) => set(i, c.key, e.target.value)}
                      />
                    )}
                  </span>
                );
              })}
              <span role="cell" className="flex items-center">
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  className="rounded px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                  aria-label={`Remove row ${i + 1}`}
                >
                  Remove
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setRows((rs) => [...rs, empty()])}
        className="border-brand-600 text-brand-800 hover:bg-brand-50 mt-1.5 rounded border px-2.5 py-1 text-xs font-medium"
      >
        + {addLabel}
      </button>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {messages?.map((m) => (
        <p key={m} className="mt-1 text-xs text-red-700">
          {m}
        </p>
      ))}
    </div>
  );
}

/** Checkboxes whose ticked values travel as a JSON array in a hidden input named `name`. */
export function MultiCheckField({
  name,
  label,
  options,
  initial,
  errors,
  hint,
  columns = 3,
  onChange,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  /** JSON array of values. */
  initial: string | undefined;
  errors?: Record<string, string[]>;
  hint?: React.ReactNode;
  columns?: number;
  /** Told the ticked values after each change. */
  onChange?: (values: string[]) => void;
}) {
  const [ticked, setTicked] = useState<string[]>(() => {
    try {
      const v: unknown = JSON.parse(initial || "[]");
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  });
  const toggle = (value: string, on: boolean) => {
    const next = on
      ? options.map((o) => o.value).filter((v) => v === value || ticked.includes(v))
      : ticked.filter((v) => v !== value);
    setTicked(next);
    onChange?.(next);
  };
  const messages = errors?.[name];
  return (
    <fieldset className="sm:col-span-2 lg:col-span-3">
      <legend className="mb-1 text-sm font-medium text-gray-800">{label}</legend>
      <input type="hidden" name={name} value={JSON.stringify(ticked)} />
      <div
        className={`grid gap-x-4 gap-y-1 sm:grid-cols-2 ${columns >= 3 ? "lg:grid-cols-3" : ""}`}
      >
        {options.map((o) => (
          <label key={o.value} className="flex items-start gap-1.5 text-sm text-gray-800">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={ticked.includes(o.value)}
              onChange={(e) => toggle(o.value, e.target.checked)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {messages?.map((m) => (
        <p key={m} className="mt-1 text-xs text-red-700">
          {m}
        </p>
      ))}
    </fieldset>
  );
}
