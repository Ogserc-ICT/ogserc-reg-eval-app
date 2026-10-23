"use client";

import { useState } from "react";
import { formatValue, type ValueFormat } from "./format";

export interface BarSeries {
  name: string;
  /** A CSS colour role, e.g. "var(--viz-series-1)". */
  colour: string;
}

export interface BarRow {
  key: string;
  label: string;
  /** One value per series (stacked left to right). */
  values: number[];
}

/**
 * Horizontal bars, single or stacked. Each row is the hover/focus target (bigger than the mark); the
 * total sits at the bar's tip; stacked segments are separated by a 2px surface gap; a legend is shown
 * for two or more series.
 */
export function BarChart({
  rows,
  series,
  format,
  labelWidth = "11rem",
}: {
  rows: BarRow[];
  series: BarSeries[];
  format: ValueFormat;
  labelWidth?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.values.reduce((a, b) => a + b, 0)));

  return (
    <div>
      {series.length > 1 && <Legend series={series} />}
      <ul className="space-y-1">
        {rows.map((row) => {
          const total = row.values.reduce((a, b) => a + b, 0);
          const summary = `${row.label}: ${series.map((s, i) => `${s.name} ${formatValue(row.values[i] ?? 0, format)}`).join(", ")}`;
          return (
            <li
              key={row.key}
              tabIndex={0}
              aria-label={summary}
              onPointerEnter={() => setActive(row.key)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(row.key)}
              onBlur={() => setActive(null)}
              className="focus-visible:ring-brand-600 relative grid items-center gap-2 rounded px-1 py-0.5 outline-none hover:bg-gray-50 focus-visible:ring-2"
              style={{ gridTemplateColumns: `${labelWidth} 1fr` }}
            >
              <span className="truncate text-xs text-[color:var(--viz-ink-2)]" title={row.label}>
                {row.label}
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="flex h-3.5 items-stretch"
                  style={{ width: `${(total / max) * 85}%` }}
                >
                  {row.values.map((v, i) =>
                    v > 0 ? (
                      <span
                        key={i}
                        className="h-full first:rounded-l-none last:rounded-r [&:not(:first-child)]:ml-[2px]"
                        style={{ width: `${(v / total) * 100}%`, background: series[i]?.colour }}
                      />
                    ) : null,
                  )}
                </span>
                <span className="text-xs text-gray-700 tabular-nums">
                  {formatValue(total, format)}
                </span>
              </span>
              {active === row.key && (
                <Tooltip title={row.label} series={series} values={row.values} format={format} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Legend({
  series,
  shape = "rect",
}: {
  series: BarSeries[];
  shape?: "rect" | "line";
}) {
  return (
    <ul className="mb-2 flex flex-wrap gap-4 text-xs text-gray-700">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={shape === "rect" ? "h-2.5 w-2.5 rounded-sm" : "h-0.5 w-3"}
            style={{ background: s.colour }}
          />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

/** One tooltip for every series: values lead (strong), names follow, keyed by a short line. */
export function Tooltip({
  title,
  series,
  values,
  format,
  className = "left-[11rem] top-full",
}: {
  title: string;
  series: BarSeries[];
  values: number[];
  format: ValueFormat;
  className?: string;
}) {
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute z-20 mt-1 min-w-40 rounded border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-md ${className}`}
    >
      <span className="mb-1 block text-gray-500">{title}</span>
      {series.map((s, i) => (
        <span key={s.name} className="flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-3" style={{ background: s.colour }} />
          <strong className="font-semibold text-gray-900 tabular-nums">
            {formatValue(values[i] ?? 0, format)}
          </strong>
          <span className="text-gray-500">{s.name}</span>
        </span>
      ))}
    </span>
  );
}
