import Link from "next/link";
import { FinanceBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { showDate, showMoney, showText } from "@/lib/format";
import { requirePermission } from "@/lib/session";
import { lagosTimestamp } from "@/server/audit-log";
import { financeDesk } from "@/server/finance";
import { toIsoDate } from "@/server/reference-data";
import { confirmPaymentAction, rejectPaymentAction } from "./actions";
import { DecisionForms } from "./decision-forms";

const NOTICES: Record<string, string> = {
  released: "Payment confirmed. The submission is released for evaluation.",
  confirmed: "Payment confirmed.",
  rejected: "Payment rejected.",
};

export default async function FinanceDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await requirePermission("payment.confirm");
  const { notice } = await searchParams;
  const { pending, decided } = await financeDesk(db, actor);
  const pendingTotal = pending.reduce((s, p) => s + p.amount, 0);

  return (
    <div>
      <PageHeader title="Finance Desk" />
      {notice && NOTICES[notice] && (
        <p
          role="status"
          className="border-brand-100 bg-brand-50 text-brand-800 mb-4 rounded border px-3 py-2 text-sm"
        >
          {NOTICES[notice]}
        </p>
      )}
      <p className="mb-4 max-w-3xl text-sm text-gray-700">
        Payments count only once confirmed here. Confirm after checking the payment against the bank
        statement or Remita; the officer who recorded a payment cannot confirm it. When confirmed
        payments cover what is due, the submission is released for evaluation automatically. A
        confirmed payment can only be undone by reversing it (Payments ledger, with a reason).
      </p>

      <section aria-label="Waiting for confirmation" className="mb-8">
        <h2 className="text-brand-800 mb-2 text-lg font-semibold">
          Waiting for confirmation ({pending.length}
          {pending.length ? `, ${showMoney(pendingTotal)}` : ""})
        </h2>
        {pending.length ? (
          <div className="overflow-x-auto rounded border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Waiting</th>
                  <th className="px-3 py-2 font-medium">Payment</th>
                  <th className="px-3 py-2 font-medium">For</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Channel / RRR</th>
                  <th className="px-3 py-2 font-medium">Recorded by</th>
                  <th className="px-3 py-2 font-medium">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pending.map((p) => (
                  <tr key={p.id} className="align-top">
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {p.daysWaiting} day{p.daysWaiting === 1 ? "" : "s"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {p.paymentNo}
                      <span className="block text-xs text-gray-500">
                        Received {showDate(toIsoDate(p.dateReceived))}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {p.href ? (
                        <Link href={p.href} className="text-brand-700 hover:underline">
                          {p.reference}
                        </Link>
                      ) : (
                        p.reference
                      )}
                      <span className="block text-xs text-gray-500">{p.payer}</span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                      {showMoney(p.amount)}
                    </td>
                    <td className="px-3 py-2">
                      {showText(p.channel)}
                      {p.rrr && <span className="block text-xs text-gray-500">{p.rrr}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{p.recordedBy}</td>
                    <td className="min-w-64 px-3 py-2">
                      <DecisionForms
                        paymentNo={p.paymentNo}
                        recordedByMe={p.recordedByMe}
                        confirm={confirmPaymentAction.bind(null, p.id)}
                        reject={rejectPaymentAction.bind(null, p.id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Nothing is waiting for confirmation.</p>
        )}
      </section>

      <section aria-label="Recent decisions">
        <h2 className="text-brand-800 mb-2 text-lg font-semibold">Recent decisions</h2>
        {decided.length ? (
          <div className="overflow-x-auto rounded border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-600">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Payment</th>
                  <th className="px-3 py-2 font-medium">For</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {decided.map((p) => (
                  <tr key={p.id} className="align-top">
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {p.decidedAt ? lagosTimestamp(p.decidedAt) : ""}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{p.paymentNo}</td>
                    <td className="px-3 py-2">
                      {p.reference}
                      <span className="block text-xs text-gray-500">{p.payer}</span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                      {showMoney(p.amount)}
                    </td>
                    <td className="px-3 py-2">
                      <FinanceBadge status={p.financeStatus} /> by {p.decidedBy}
                      {p.remarks && (
                        <span className="block text-xs text-gray-600">{p.remarks}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No decisions yet.</p>
        )}
      </section>
    </div>
  );
}
