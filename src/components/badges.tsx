import type { DataFlag } from "@/domain/flags";
import type { PaymentStatus } from "@/domain/fees";
import type { SlaLight } from "@/domain/sla";
import type { FinanceStatus, Status } from "@/domain/types";

const base = "inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium";

const STATUS_STYLE: Record<Status, string> = {
  "Acknowledged - Awaiting Payment": "bg-orange-100 text-orange-900",
  "Received - Under Review": "bg-sky-100 text-sky-900",
  "Deficiency Notice Issued": "bg-amber-100 text-amber-900",
  "Provisionally Registered": "bg-violet-100 text-violet-900",
  Registered: "bg-brand-100 text-brand-900",
  Lapsed: "bg-gray-200 text-gray-700",
  Refused: "bg-red-100 text-red-900",
  Cancelled: "bg-gray-200 text-gray-700",
  "Changes Applied": "bg-teal-100 text-teal-900",
};

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`${base} ${STATUS_STYLE[status]}`}>{status}</span>;
}

const SLA_STYLE: Record<SlaLight, string> = {
  Red: "bg-red-600 text-white",
  Amber: "bg-gold-400 text-gray-900",
  Green: "bg-brand-600 text-white",
};

export function SlaBadge({ sla }: { sla: SlaLight | null }) {
  if (!sla) return <span className="text-gray-400">—</span>;
  return <span className={`${base} ${SLA_STYLE[sla]}`}>{sla}</span>;
}

const PAYMENT_STYLE: Record<PaymentStatus, string> = {
  Paid: "bg-brand-100 text-brand-900",
  "Part-paid": "bg-amber-100 text-amber-900",
  Unpaid: "bg-red-100 text-red-900",
  Nil: "bg-gray-100 text-gray-700",
};

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return <span className={`${base} ${PAYMENT_STYLE[status]}`}>{status}</span>;
}

export function FlagList({ flags }: { flags: readonly DataFlag[] }) {
  if (!flags.length) return <p className="text-sm text-gray-500">No data flags.</p>;
  return (
    <ul className="space-y-1">
      {flags.map((f) => (
        <li
          key={f.code}
          className="rounded border-l-4 border-amber-500 bg-amber-50 px-2 py-1 text-sm text-amber-950"
        >
          {f.message}
        </li>
      ))}
    </ul>
  );
}

const FINANCE_LABEL: Record<FinanceStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  REJECTED: "Rejected",
};
const FINANCE_STYLE: Record<FinanceStatus, string> = {
  PENDING: "bg-amber-100 text-amber-900",
  CONFIRMED: "bg-brand-100 text-brand-900",
  REJECTED: "bg-red-100 text-red-900",
};

/** Finance decision on a payment (§4.12): only Confirmed counts. */
export function FinanceBadge({ status }: { status: FinanceStatus }) {
  return <span className={`${base} ${FINANCE_STYLE[status]}`}>{FINANCE_LABEL[status]}</span>;
}
