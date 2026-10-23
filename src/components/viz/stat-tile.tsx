import Link from "next/link";

type Status = "critical" | "warning" | "good";
const STATUS: Record<Status, { colour: string; icon: string; label: string }> = {
  critical: { colour: "var(--status-critical)", icon: "●", label: "Overdue" },
  warning: { colour: "var(--status-warning)", icon: "▲", label: "Due soon" },
  good: { colour: "var(--status-good)", icon: "✓", label: "On track" },
};

/** Stat tile: label, value (proportional figures), optional hint; links to the records it counts. */
export function StatTile({
  label,
  value,
  hint,
  href,
  status,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  /** Status tiles carry an icon and label, never colour alone. */
  status?: Status;
}) {
  const body = (
    <>
      <span className="block text-xs text-gray-600">{label}</span>
      <span className="mt-0.5 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-gray-900">{value}</span>
        {status && (
          <span className="text-xs" style={{ color: STATUS[status].colour }}>
            <span aria-hidden>{STATUS[status].icon}</span>{" "}
            <span className="text-gray-700">{STATUS[status].label}</span>
          </span>
        )}
      </span>
      {hint && <span className="mt-0.5 block text-xs text-gray-500">{hint}</span>}
    </>
  );
  const className = "block rounded border border-gray-200 bg-white px-3 py-2.5";
  return href ? (
    <Link
      href={href}
      className={`${className} hover:border-brand-600 focus-visible:ring-brand-600 focus-visible:ring-2`}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** A single ratio against a whole: the track is a lighter step of the fill's own hue. */
export function Meter({
  label,
  fraction,
  display,
}: {
  label: string;
  fraction: number | null;
  display: string;
}) {
  const pct = Math.max(0, Math.min(1, fraction ?? 0)) * 100;
  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2.5">
      <span className="block text-xs text-gray-600">{label}</span>
      <span className="mt-0.5 block text-2xl font-semibold text-gray-900">{display}</span>
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="mt-2 block h-2 overflow-hidden rounded"
        style={{ background: "var(--viz-track)" }}
      >
        <span
          className="block h-full rounded"
          style={{ width: `${pct}%`, background: "var(--viz-series-1)" }}
        />
      </span>
    </div>
  );
}
