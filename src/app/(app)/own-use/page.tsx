import Link from "next/link";
import { PaymentBadge } from "@/components/badges";
import { inputClass } from "@/components/form";
import { PageHeader } from "@/components/page-header";
import { can } from "@/domain/roles";
import { db } from "@/lib/db";
import { showDate, showMoney } from "@/lib/format";
import { requirePermission } from "@/lib/session";
import { listOwnUse } from "@/server/own-use";

export default async function OwnUsePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; overpaid?: string }>;
}) {
  const user = await requirePermission("records.read");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const overpaid = sp.overpaid === "1";
  const all = await listOwnUse(db);
  const rows = all.filter(
    ({ row, assessment }) =>
      (!q || [row.ounNo, row.name, row.cacNo ?? "", row.lga].join(" ").toLowerCase().includes(q)) &&
      (!overpaid || assessment.balance < 0),
  );

  return (
    <div>
      <PageHeader title="Own-use notifications (Form REG-01I)">
        {can(user.roles, "ownUse.create") && (
          <Link
            href="/own-use/new"
            className="bg-brand-700 hover:bg-brand-800 rounded px-3 py-2 text-sm font-medium text-white"
          >
            New notification
          </Link>
        )}
      </PageHeader>
      <p className="mb-3 max-w-3xl text-sm text-gray-600">
        Own-use generation from the notification threshold to below 1 MW (para 3(4)), Schedule 3
        Category I.
      </p>
      <form method="get" role="search" className="mb-4 flex max-w-xl gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="OUN No., name, CAC or LGA"
          aria-label="Search"
          className={inputClass}
        />
        <label className="flex items-center gap-1.5 text-sm whitespace-nowrap">
          <input type="checkbox" name="overpaid" value="1" defaultChecked={overpaid} />
          Overpaid / credits
        </label>
        <button
          type="submit"
          className="bg-brand-700 hover:bg-brand-800 rounded px-3 text-sm text-white"
        >
          Search
        </button>
      </form>
      {rows.length ? (
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-50 text-brand-900 text-xs">
              <tr>
                <th className="px-2 py-2">OUN No.</th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">LGA</th>
                <th className="px-2 py-2">Filed</th>
                <th className="px-2 py-2 text-right">kW</th>
                <th className="px-2 py-2">Eligibility</th>
                <th className="px-2 py-2 text-right">Fee due</th>
                <th className="px-2 py-2">Payment</th>
                <th className="px-2 py-2">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ row, input, assessment: a }) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <Link
                      href={`/own-use/${row.id}`}
                      className="text-brand-700 font-medium hover:underline"
                    >
                      {row.ounNo}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">{row.name}</td>
                  <td className="px-2 py-1.5">{row.lga}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{showDate(input.dateFiled)}</td>
                  <td className="px-2 py-1.5 text-right">
                    {a.installedCapacityKw?.toLocaleString("en-NG")}
                  </td>
                  <td className="px-2 py-1.5">{a.eligibility}</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {showMoney(a.feeDue)}
                  </td>
                  <td className="px-2 py-1.5">
                    <PaymentBadge status={a.paymentStatus} />
                  </td>
                  <td className="px-2 py-1.5" title={a.flags.map((f) => f.message).join("\n")}>
                    {a.flags.length || <span className="text-gray-400">0</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded border border-gray-200 bg-white p-6 text-sm text-gray-600">
          No notifications.
        </p>
      )}
    </div>
  );
}
