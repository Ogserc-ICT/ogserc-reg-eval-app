/** A chart's container: title, optional caption, the chart, and its table-view twin (accessibility). */
export function ChartCard({
  title,
  caption,
  children,
  table,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
  table: React.ReactNode;
}) {
  return (
    <figure className="min-w-0 rounded border border-gray-200 bg-white p-4">
      <figcaption className="mb-3">
        <span className="text-brand-800 block text-sm font-semibold">{title}</span>
        {caption && <span className="block text-xs text-gray-500">{caption}</span>}
      </figcaption>
      {children}
      <details className="mt-3 text-sm">
        <summary className="text-brand-700 cursor-pointer text-xs hover:underline">
          Show as table
        </summary>
        <div className="mt-2 overflow-x-auto">{table}</div>
      </details>
    </figure>
  );
}

/** Plain data table used as every chart's table view. */
export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-left text-xs">
      <thead className="text-gray-500">
        <tr>
          {head.map((h, i) => (
            <th key={h} className={`py-1 pr-3 font-normal ${i ? "text-right" : ""}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 tabular-nums">
        {rows.map((r) => (
          <tr key={String(r[0])}>
            {r.map((c, i) => (
              <td key={i} className={`py-1 pr-3 ${i ? "text-right" : ""}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
