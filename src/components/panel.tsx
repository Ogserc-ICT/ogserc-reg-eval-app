/** A titled card used on record pages. */
export function Panel({
  title,
  actions,
  children,
  id,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="rounded border border-gray-200 bg-white"
      aria-labelledby={id ? `${id}-title` : undefined}
    >
      <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-2">
        <h2 id={id ? `${id}-title` : undefined} className="text-brand-800 text-sm font-semibold">
          {title}
        </h2>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A Panel that starts closed: its title bar opens it (no script needed). */
export function FoldedPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded border border-gray-200 bg-white">
      <summary className="text-brand-800 hover:bg-brand-50 flex cursor-pointer list-none items-center justify-between gap-3 rounded px-4 py-2 text-sm font-semibold">
        <h2>{title}</h2>
        <span aria-hidden="true" className="text-xs text-gray-500 group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="border-t border-gray-100 p-4">{children}</div>
    </details>
  );
}

/** Label/value grid. */
export function Facts({
  items,
  columns = 2,
}: {
  items: [string, React.ReactNode][];
  columns?: 1 | 2 | 3;
}) {
  const cols = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[columns];
  return (
    <dl className={`grid gap-x-6 gap-y-2 text-sm ${cols}`}>
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-gray-500">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
