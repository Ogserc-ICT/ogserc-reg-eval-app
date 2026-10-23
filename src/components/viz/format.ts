import { formatNaira } from "@/domain/money";

/** How a chart's values are shown. Passed as a name, since functions cannot cross to client components. */
export type ValueFormat = "count" | "naira";

export function formatValue(value: number, format: ValueFormat): string {
  return format === "naira" ? formatNaira(value) : value.toLocaleString("en-NG");
}

/** Compact axis ticks: 0 / 500 / 1K / 2.5M, or ₦0 / ₦500K / ₦2.5M. */
export function formatTick(value: number, format: ValueFormat): string {
  const n = format === "naira" ? value / 100 : value;
  const compact =
    n >= 1_000_000
      ? `${trim(n / 1_000_000)}M`
      : n >= 1_000
        ? `${trim(n / 1_000)}K`
        : String(Math.round(n));
  return format === "naira" ? `₦${compact}` : compact;
}

const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

/** Round, readable axis ticks from 0 to at least `max` (about four steps). */
export function niceTicks(max: number, format: ValueFormat): number[] {
  const unit = format === "naira" ? 100 : 1;
  const top = Math.max(max / unit, 1);
  const rough = top / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const integerStep = format === "count" ? Math.max(1, Math.ceil(step)) : step;
  const ticks: number[] = [];
  for (let t = 0; t < top + integerStep; t += integerStep) {
    ticks.push(t * unit);
    if (t >= top) break;
  }
  return ticks;
}
