import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { inputClass } from "@/components/form";
import { PageHeader } from "@/components/page-header";
import { can } from "@/domain/roles";
import { db } from "@/lib/db";
import { showMoney } from "@/lib/format";
import { requirePermission } from "@/lib/session";
import { loadFormOptions } from "@/server/options";
import { koboToNumber } from "@/server/reference-data";
import { PaymentsTable } from "./payments-table";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const NOTICES: Record<string, string> = { payment: "Payment recorded." };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("records.read");
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const status = one(sp.status);
  const finance = one(sp.finance);
  const channel = one(sp.channel);

  const where: Prisma.PaymentWhereInput = {
    ...(q && {
      OR: [
        { paymentNo: { contains: q, mode: "insensitive" } },
        { reference: { contains: q, mode: "insensitive" } },
        { rrr: { contains: q, mode: "insensitive" } },
      ],
    }),
    ...(status === "ACTIVE" || status === "REVERSED" ? { status } : {}),
    ...(finance === "PENDING" || finance === "CONFIRMED" || finance === "REJECTED"
      ? { financeStatus: finance }
      : {}),
    ...(channel && { channel }),
  };
  const [payments, options] = await Promise.all([
    db.payment.findMany({
      where,
      orderBy: { paymentSeq: "desc" },
      take: 500,
      include: {
        recordedBy: { select: { name: true } },
        verifiedBy: { select: { name: true } },
        financeDecidedBy: { select: { name: true } },
        reversedBy: { select: { name: true } },
      },
    }),
    loadFormOptions(db),
  ]);
  const rows = payments.map((p) => ({
    ...p,
    amountKobo: koboToNumber(p.amount),
    referenceHref: p.submissionId
      ? `/submissions/${p.submissionId}`
      : p.ownUseNotificationId
        ? `/own-use/${p.ownUseNotificationId}`
        : null,
  }));
  const active = rows.filter((r) => r.status === "ACTIVE");
  const sumOf = (status: string) =>
    active.filter((r) => r.financeStatus === status).reduce((s, r) => s + r.amountKobo, 0);

  const select = (name: string, label: string, choices: { value: string; label: string }[]) => (
    <label className="text-xs text-gray-600">
      {label}
      <select name={name} defaultValue={one(sp[name])} className={`${inputClass} mt-0.5`}>
        <option value="">All</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div>
      <PageHeader title="Payments ledger">
        {can(user.roles, "payment.record") && (
          <Link
            href="/payments/new"
            className="bg-brand-700 hover:bg-brand-800 rounded px-3 py-2 text-sm font-medium text-white"
          >
            Record payment
          </Link>
        )}
      </PageHeader>

      {NOTICES[one(sp.notice)] && (
        <p
          role="status"
          className="border-brand-100 bg-brand-50 text-brand-800 mb-4 rounded border px-3 py-2 text-sm"
        >
          {NOTICES[one(sp.notice)]}
        </p>
      )}

      <form
        method="get"
        role="search"
        className="mb-4 grid grid-cols-2 gap-3 rounded border border-gray-200 bg-white p-3 md:grid-cols-5"
      >
        <label className="col-span-2 text-xs text-gray-600">
          Search
          <input
            name="q"
            defaultValue={q}
            placeholder="Payment No., Ack/OUN No. or RRR"
            className={`${inputClass} mt-0.5`}
          />
        </label>
        {select("status", "Status", [
          { value: "ACTIVE", label: "Active" },
          { value: "REVERSED", label: "Reversed" },
        ])}
        {select("finance", "Finance", [
          { value: "PENDING", label: "Pending" },
          { value: "CONFIRMED", label: "Confirmed" },
          { value: "REJECTED", label: "Rejected" },
        ])}
        {select(
          "channel",
          "Channel",
          options.paymentChannels.map((c) => ({ value: c, label: c })),
        )}
        <div className="col-span-2 flex items-center gap-3 md:col-span-5">
          <button
            type="submit"
            className="bg-brand-700 hover:bg-brand-800 rounded px-3 py-1.5 text-sm text-white"
          >
            Apply
          </button>
          <Link href="/payments" className="text-brand-700 text-sm hover:underline">
            Clear
          </Link>
          <span className="ml-auto text-sm text-gray-600">
            Shown: {active.length} active payments · confirmed {showMoney(sumOf("CONFIRMED"))} ·
            pending {showMoney(sumOf("PENDING"))}
          </span>
        </div>
      </form>

      <div className="rounded border border-gray-200 bg-white p-3">
        <PaymentsTable rows={rows} roles={user.roles} />
      </div>
      {payments.length === 500 && (
        <p className="mt-2 text-xs text-gray-500">
          Showing the latest 500. Narrow the search to see older payments.
        </p>
      )}
    </div>
  );
}
