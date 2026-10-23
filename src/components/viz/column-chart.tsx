"use client";

import { useState } from "react";
import { Legend, Tooltip, type BarSeries } from "./bar-chart";
import { formatTick, niceTicks, type ValueFormat } from "./format";

export interface ColumnPoint {
  key: string;
  /** Axis label, e.g. "Oct" (with the year shown on the first month and on January). */
  label: string;
  /** Full label for the tooltip, e.g. "October 2026". */
  title: string;
  values: number[];
}

const PLOT_HEIGHT = 170;

/**
 * Grouped columns over time on one axis (never two). The whole month band is the hover/focus target
 * and its tooltip lists every series. Columns ≤ 24px wide, 4px rounded tops, 2px gap between series.
 */
export function ColumnChart({
  points,
  series,
  format,
}: {
  points: ColumnPoint[];
  series: BarSeries[];
  format: ValueFormat;
}) {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(0, ...points.flatMap((p) => p.values));
  const ticks = niceTicks(max, format);
  const top = ticks[ticks.length - 1] || 1;

  return (
    <div>
      {series.length > 1 && <Legend series={series} />}
      {/* Headroom so the top tick label never rides up into the legend or caption. */}
      <div className="flex pt-3">
        {/* Y axis */}
        <div className="relative mr-2 w-12 shrink-0" style={{ height: PLOT_HEIGHT }}>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2 text-[10px] text-[color:var(--viz-muted)] tabular-nums"
              style={{ bottom: `${(t / top) * 100}%` }}
            >
              {formatTick(t, format)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height: PLOT_HEIGHT }}>
            {ticks.map((t) => (
              <span
                key={t}
                aria-hidden
                className="absolute inset-x-0 h-px"
                style={{
                  bottom: `${(t / top) * 100}%`,
                  background: t === 0 ? "var(--viz-axis)" : "var(--viz-grid)",
                }}
              />
            ))}
            <ol className="absolute inset-0 flex">
              {points.map((p, index) => (
                <li
                  key={p.key}
                  tabIndex={0}
                  aria-label={`${p.title}: ${series.map((s, i) => `${s.name} ${p.values[i] ?? 0}`).join(", ")}`}
                  onPointerEnter={() => setActive(p.key)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(p.key)}
                  onBlur={() => setActive(null)}
                  className="focus-visible:ring-brand-600 relative flex flex-1 items-end justify-center gap-[2px] outline-none hover:bg-gray-50/70 focus-visible:ring-2"
                >
                  {p.values.map((v, i) => (
                    <span
                      key={i}
                      className="w-full max-w-[24px] rounded-t"
                      style={{
                        height: `${(v / top) * 100}%`,
                        minHeight: v > 0 ? 2 : 0,
                        background: series[i]?.colour,
                      }}
                    />
                  ))}
                  {active === p.key && (
                    <Tooltip
                      title={p.title}
                      series={series}
                      values={p.values}
                      format={format}
                      className={`top-2 ${index > points.length / 2 ? "right-full mr-1" : "left-full ml-1"}`}
                    />
                  )}
                </li>
              ))}
            </ol>
          </div>
          {/* X axis labels (part of the chart's height, not clipped) */}
          <ol className="mt-1 flex" aria-hidden>
            {points.map((p) => (
              <li
                key={p.key}
                className="flex-1 text-center text-[10px] text-[color:var(--viz-muted)]"
              >
                {p.label}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
