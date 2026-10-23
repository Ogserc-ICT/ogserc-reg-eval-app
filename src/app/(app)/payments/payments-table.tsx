import Link from "next/link";
import { FinanceBadge } from "@/components/badges";
import { can, type Role } from "@/domain/roles";
import type { FinanceStatus } from "@/domain/types";
import { showDate, showMoney, showText } from "@/lib/format";
import { toIsoDate } from "@/server/reference-data";
import { reversePaymentAction } from "./actions";
import { PaymentRowActions } from "./payment-row-actions";

export interface PaymentTableRow {
  id: string;
  paymentNo: string;
  dateReceived: Date;
  reference: string;
  /** Link for the reference (submission or own-use page), if known. */
  referenceHref?: string | null;
  purpose: string | null;
  channel: string | null;
  amountKobo: number;
  rrr: string | null;
  status: "ACTIVE" | "REVERSED";
  /** Finance decision (§4.12): only Confirmed counts. */
  financeStatus: FinanceStatus;
  financeDecidedAt: Date | null;
  financeDecidedBy?: { name: string } | null;
  financeRemarks: string | null;
  reversalReason: string | null;
  reversedAt: Date | null;
  reversedBy?: { name: string } | null;
  recordedBy?: { name: string } | null;
}

/**
 * Payment rows with their Finance status; reversed ones stay visible, struck through, with who, when
 * and why. Confirming or rejecting happens on the Finance Desk.
 */
export function PaymentsTable({
  rows,
  roles,
  showReference = true,
}: {
  rows: PaymentTableRow[];
  roles: Role[];
  showReference?: boolean;
}) {
  if (!rows.length) return <p className="text-sm text-gray-500">No payments recorded.</p>;
  const canConfirm = can(roles, "payment.confirm");
  const canReverse = can(roles, "payment.reverse");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-gray-500">
          <tr>
            <th className="py-1 pr-2 font-normal">Payment No.</th>
            <th className="py-1 pr-2 font-normal">Received</th>
            {showReference && <th className="py-1 pr-2 font-normal">Reference</th>}
            <th className="py-1 pr-2 text-right font-normal">Amount</th>
            <th className="py-1 pr-2 font-normal">Channel / RRR</th>
            <th className="py-1 pr-2 font-normal">Purpose</th>
            <th className="py-1 pr-2 font-normal">Finance</th>
            <th className="py-1 font-normal">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((p) => {
            const reversed = p.status === "REVERSED";
            return (
              <tr key={p.id} className={`align-top ${reversed ? "bg-gray-50 text-gray-500" : ""}`}>
                <td className="py-1.5 pr-2 whitespace-nowrap">
                  <span className={reversed ? "line-through" : ""}>{p.paymentNo}</span>
                  {reversed && (
                    <p className="text-xs text-red-800">
                      Reversed {showDate(toIsoDate(p.reversedAt))}
                      {p.reversedBy ? ` by ${p.reversedBy.name}` : ""}: {p.reversalReason}
                    </p>
                  )}
                </td>
                <td className="py-1.5 pr-2 whitespace-nowrap">
                  {showDate(toIsoDate(p.dateReceived))}
                </td>
                {showReference && (
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    {p.referenceHref ? (
                      <Link href={p.referenceHref} className="text-brand-700 hover:underline">
                        {p.reference}
                      </Link>
                    ) : (
                      p.reference
                    )}
                  </td>
                )}
                <td
                  className={`py-1.5 pr-2 text-right whitespace-nowrap ${reversed ? "line-through" : ""}`}
                >
                  {showMoney(p.amountKobo)}
                </td>
                <td className="py-1.5 pr-2">
                  {showText(p.channel)}
                  {p.rrr && <span className="block text-xs text-gray-500">{p.rrr}</span>}
                </td>
                <td className="py-1.5 pr-2">{showText(p.purpose)}</td>
                <td className="py-1.5 pr-2">
                  <FinanceBadge status={p.financeStatus} />
                  {p.financeStatus !== "PENDING" && (
                    <span className="block text-xs text-gray-500">
                      {p.financeDecidedBy?.name}
                      {p.financeDecidedAt ? `, ${showDate(toIsoDate(p.financeDecidedAt))}` : ""}
                      {p.financeRemarks ? `: ${p.financeRemarks}` : ""}
                    </span>
                  )}
                  {p.financeStatus === "PENDING" && !reversed && canConfirm && (
                    <Link href="/finance" className="text-brand-700 block text-xs hover:underline">
                      Finance Desk
                    </Link>
                  )}
                </td>
                <td className="py-1.5">
                  {!reversed && p.financeStatus !== "REJECTED" && canReverse && (
                    <PaymentRowActions reverse={reversePaymentAction.bind(null, p.id)} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
