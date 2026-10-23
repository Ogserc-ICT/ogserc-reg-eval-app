import Link from "next/link";
import { inputClass } from "@/components/form";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { lagosTimestamp, listAudit, type AuditFilters } from "@/server/audit-log";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const FILTER_KEYS = ["from", "to", "user", "action", "q"] as const;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requirePermission("audit.read");
  const sp = await searchParams;
  const filters: AuditFilters = Object.fromEntries(FILTER_KEYS.map((k) => [k, one(sp[k])]));
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const { rows, total, pages, actions, users } = await listAudit(db, actor, filters, page);

  const query = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams(
      FILTER_KEYS.flatMap((k) => (filters[k] ? [[k, filters[k]!]] : [])),
    );
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div>
      <PageHeader title="Audit log">
        <a
          href={`/audit/export${query()}`}
          className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
        >
          Export CSV
        </a>
      </PageHeader>

      <form method="get" role="search" className="mb-4 rounded border border-gray-200 bg-white p-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <label className="text-xs text-gray-600">
            From
            <input
              type="date"
              name="from"
              defaultValue={filters.from}
              className={`${inputClass} mt-0.5`}
            />
          </label>
          <label className="text-xs text-gray-600">
            To
            <input
              type="date"
              name="to"
              defaultValue={filters.to}
              className={`${inputClass} mt-0.5`}
            />
          </label>
          <label className="text-xs text-gray-600">
            User
            <select name="user" defaultValue={filters.user} className={`${inputClass} mt-0.5`}>
              <option value="">All</option>
              <option value="system">System (scheduled job)</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            Action
            <select name="action" defaultValue={filters.action} className={`${inputClass} mt-0.5`}>
              <option value="">All</option>
              {actions.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label className="col-span-2 text-xs text-gray-600">
            Search
            <input
              name="q"
              defaultValue={filters.q}
              placeholder="Reference or detail"
              className={`${inputClass} mt-0.5`}
            />
          </label>
        </div>
        <div className="mt-3 flex items-center justify-end gap-4">
          <button
            type="submit"
            className="bg-brand-700 hover:bg-brand-800 rounded px-3 py-1.5 text-sm text-white"
          >
            Apply
          </button>
          <Link href="/audit" className="text-brand-700 text-sm hover:underline">
            Clear
          </Link>
        </div>
      </form>

      <p className="mb-2 text-sm text-gray-600">
        {total.toLocaleString("en-NG")} {total === 1 ? "entry" : "entries"}, newest first
        {pages > 1 && ` · page ${page} of ${pages}`}. Times are Lagos time. Entries cannot be edited
        or deleted.
      </p>
      <div className="overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-600">
            <tr>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Reference</th>
              <th className="px-3 py-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-3 py-2 whitespace-nowrap text-gray-700 tabular-nums">
                  {lagosTimestamp(r.timestamp)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.user ?? <span className="text-gray-500 italic">System</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{r.action}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.href ? (
                    <Link href={r.href} className="text-brand-700 hover:underline">
                      {r.reference}
                    </Link>
                  ) : (
                    r.reference
                  )}
                </td>
                <td className="px-3 py-2 wrap-break-word text-gray-700">{r.detail}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                  No entries match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-3 flex gap-4 text-sm">
          {page > 1 && (
            <Link
              href={`/audit${query({ page: String(page - 1) })}`}
              className="text-brand-700 hover:underline"
            >
              ← Newer
            </Link>
          )}
          {page < pages && (
            <Link
              href={`/audit${query({ page: String(page + 1) })}`}
              className="text-brand-700 hover:underline"
            >
              Older →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
