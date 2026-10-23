import Link from "next/link";
import { notFound } from "next/navigation";
import { FlagList, PaymentBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { Facts, Panel } from "@/components/panel";
import { can } from "@/domain/roles";
import { db } from "@/lib/db";
import { showDate, showMoney, showText } from "@/lib/format";
import { requirePermission } from "@/lib/session";
import { getOwnUseDetail } from "@/server/own-use";
import { PaymentsTable } from "../../payments/payments-table";
import { RecalculateForm } from "../../submissions/[id]/record-forms";
import { recalculateOwnUseAction } from "../actions";

const NOTICES: Record<string, string> = {
  created: "Notification saved.",
  updated: "Changes saved.",
  payment: "Payment recorded.",
};

export default async function OwnUseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const user = await requirePermission("records.read");
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const d = await getOwnUseDetail(db, id);
  if (!d) notFound();
  const { row, input, assessment: a } = d;

  return (
    <div className="space-y-4">
      <PageHeader title={row.name} back={{ href: "/own-use", label: "Own-use notifications" }}>
        <div className="flex gap-2">
          {can(user.roles, "ownUse.create") && (
            <Link
              href={`/own-use/${id}/edit`}
              className="border-brand-700 text-brand-700 hover:bg-brand-50 rounded border px-3 py-1.5 text-sm"
            >
              Edit details
            </Link>
          )}
          {can(user.roles, "payment.record") && (
            <Link
              href={`/payments/new?reference=${encodeURIComponent(row.ounNo)}&returnTo=${encodeURIComponent(`/own-use/${id}`)}`}
              className="bg-brand-700 hover:bg-brand-800 rounded px-3 py-1.5 text-sm font-medium text-white"
            >
              Record payment
            </Link>
          )}
        </div>
      </PageHeader>

      {notice && NOTICES[notice] && (
        <p
          role="status"
          className="border-brand-100 bg-brand-50 text-brand-800 rounded border px-3 py-2 text-sm"
        >
          {NOTICES[notice]}
        </p>
      )}
      <p className="font-mono text-sm">{row.ounNo}</p>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={`Data flags (${a.flags.length})`}>
          <FlagList flags={a.flags} />
        </Panel>
        <Panel title="Eligibility and fee (para 3(4), Category I)">
          <Facts
            items={[
              ["Installed capacity", `${input.installedCapacityKw?.toLocaleString("en-NG")} kW`],
              ["Eligibility", showText(a.eligibility)],
              ["Fee due", showMoney(a.feeDue)],
              ["Paid", showMoney(a.amountPaid)],
              ["Balance", showMoney(a.balance)],
              ["Payment status", <PaymentBadge key="p" status={a.paymentStatus} />],
              ["Threshold used", `${input.pricing?.thresholdKw} kW`],
              ["Filed after the registration deadline?", a.filedLate ? "Yes" : "No"],
            ]}
          />
          {a.pricingChanges.length > 0 && (
            <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950">
              Current rules would price this differently: {a.pricingChanges.join("; ")}
            </div>
          )}
          {can(user.roles, "pricing.recalculate") && a.pricingChanges.length > 0 && (
            <RecalculateForm action={recalculateOwnUseAction.bind(null, id)} />
          )}
        </Panel>
      </div>

      <Panel title="Payments">
        <PaymentsTable rows={d.payments} roles={user.roles} showReference={false} />
      </Panel>

      <Panel title="Details">
        <Facts
          columns={3}
          items={[
            ["Date filed", showDate(input.dateFiled)],
            ["CAC number", showText(row.cacNo)],
            ["LGA", row.lga],
            ["Site address", showText(row.siteAddress)],
            ["Nature of business", showText(row.natureOfBusiness)],
            ["Grid connected", row.gridConnected === null ? "—" : row.gridConnected ? "Yes" : "No"],
            ["Distribution licensee", showText(row.distributionLicensee)],
            ["Units", showText(row.units)],
            ["Fuel / technology", showText(row.fuel)],
            [
              "Average monthly output",
              row.avgMonthlyOutputMwh ? `${row.avgMonthlyOutputMwh.toString()} MWh` : "—",
            ],
            ["Contact person", showText(row.contactPerson)],
            ["Phone / email", `${showText(row.phone)} / ${showText(row.email)}`],
            ["Entered by", row.createdBy.name],
          ]}
        />
      </Panel>

      <Panel title="History">
        {d.audit.length ? (
          <ol className="space-y-1.5 text-sm">
            {d.audit.map((e) => (
              <li key={String(e.id)} className="grid gap-x-3 sm:grid-cols-[11rem_10rem_1fr]">
                <span className="text-gray-500">
                  {e.timestamp.toLocaleString("en-GB", {
                    timeZone: "Africa/Lagos",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
                <span>
                  <strong className="font-medium">{e.action}</strong>
                  <span className="block text-xs text-gray-500">{e.user?.name ?? "System"}</span>
                </span>
                <span className="break-words text-gray-700">{e.detail}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-gray-500">No history.</p>
        )}
      </Panel>
    </div>
  );
}
