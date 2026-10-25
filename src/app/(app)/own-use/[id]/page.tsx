import Link from "next/link";
import { notFound } from "next/navigation";
import { FlagList, PaymentBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { Facts, Panel } from "@/components/panel";
import { ownUseRegistrationBlockers } from "@/domain/own-use";
import { can } from "@/domain/roles";
import { db } from "@/lib/db";
import { documentStatusText, showDate, showMoney, showText } from "@/lib/format";
import { requirePermission } from "@/lib/session";
import { loadSettings, toIsoDate } from "@/server/reference-data";
import { DOCUMENT_LABELS } from "@/server/documents";
import { getOwnUseDetail } from "@/server/own-use";
import { PaymentsTable } from "../../payments/payments-table";
import { DocumentsForm, RecalculateForm } from "../../submissions/[id]/record-forms";
import { ApproveFields, WorkflowAction } from "../../submissions/[id]/evaluation/workflow-forms";
import {
  recalculateOwnUseAction,
  registerOwnUseAction,
  updateOwnUseDocumentsAction,
} from "../actions";

const NOTICES: Record<string, string> = {
  created: "Notification saved.",
  updated: "Changes saved.",
  payment: "Payment recorded.",
};

const when = (d: Date) =>
  d.toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });

export default async function OwnUseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const user = await requirePermission("records.read");
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const [d, settings] = await Promise.all([getOwnUseDetail(db, id), loadSettings(db)]);
  if (!d) notFound();
  const { row, input, assessment: a } = d;
  const registered = !!row.registrationNo;
  const showRegistration = d.policy.ownUseCertificate || registered;
  const needsOverride =
    a.flags.some((f) => f.code !== "FEE_UNPAID") && !settings.policy.flagsBlockApproval;
  const registrationBlockers = ownUseRegistrationBlockers({
    oun: input,
    assessment: a,
    settings,
    createdById: row.createdById,
    actorId: user.id,
    flagOverrideReason: row.flagOverrideReason ?? (needsOverride ? "(reason to be given)" : null),
  });

  return (
    <div className="space-y-4">
      <PageHeader title={row.name} back={{ href: "/own-use", label: "Own-use notifications" }}>
        <div className="flex gap-2">
          {can(user.roles, "ownUse.create") && !registered && (
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
      <p className="text-sm">
        <span className="font-mono">{row.ounNo}</span> · Form REG-01I, one notification per site
        {registered && (
          <>
            {" "}
            · Registered as <strong className="font-mono">{row.registrationNo}</strong>
          </>
        )}
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={`Data flags (${a.flags.length})`}>
          <FlagList flags={a.flags} />
        </Panel>
        <Panel title="Eligibility and fee (para 3(4), Category I)">
          <Facts
            items={[
              [
                "Installed capacity (sum of units)",
                a.installedCapacityKw === null
                  ? "—"
                  : `${a.installedCapacityKw.toLocaleString("en-NG")} kW`,
              ],
              ["Eligibility", showText(a.eligibility)],
              ["Fee due", showMoney(a.feeDue)],
              ["Paid (confirmed by Finance)", showMoney(a.amountPaid)],
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

      <Panel title="C. Generation assets">
        {input.units.length ? (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-gray-500">
              <tr>
                <th className="py-1 pr-2 font-normal">Unit</th>
                <th className="py-1 pr-2 font-normal">Make / model</th>
                <th className="py-1 pr-2 text-right font-normal">Installed kW</th>
                <th className="py-1 pr-2 font-normal">Fuel / technology</th>
                <th className="py-1 text-right font-normal">Avg monthly MWh</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {input.units.map((u, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-2">{i + 1}</td>
                  <td className="py-1.5 pr-2">{showText(u.makeModel)}</td>
                  <td className="py-1.5 pr-2 text-right">{u.capacityKw.toLocaleString("en-NG")}</td>
                  <td className="py-1.5 pr-2">{showText(u.fuel)}</td>
                  <td className="py-1.5 text-right">{showText(u.avgMonthlyMwh)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-1.5 pr-2" colSpan={2}>
                  Total
                </td>
                <td className="py-1.5 pr-2 text-right">
                  {a.installedCapacityKw?.toLocaleString("en-NG")}
                </td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-500">No generator units recorded.</p>
        )}
      </Panel>

      <Panel
        title={`Documents – REG-01I (${a.documents.outstanding} outstanding, ${a.documents.pending} pending)`}
      >
        {can(user.roles, "documents.edit") && !registered ? (
          <DocumentsForm
            action={updateOwnUseDocumentsAction.bind(null, id)}
            documents={a.documents.items}
          />
        ) : (
          <ul className="space-y-1 text-sm">
            {a.documents.items.map((doc) => (
              <li key={doc.key} className="flex justify-between gap-4">
                <span>{doc.text}</span>
                <span className="text-gray-600">{documentStatusText(doc)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Payments">
        <PaymentsTable rows={d.payments} roles={user.roles} showReference={false} />
      </Panel>

      {showRegistration && (
        <Panel title="Registration and certificate">
          {registered ? (
            <Facts
              items={[
                ["Registration no.", showText(row.registrationNo)],
                ["Certificate issued", showDate(toIsoDate(row.certificateIssueDate))],
                ["Approved by", showText(row.registeredBy?.name)],
                ["Flags overridden", showText(row.flagOverrideReason)],
              ]}
            />
          ) : can(user.roles, "submission.approve") ? (
            <WorkflowAction
              title="Register and issue the certificate"
              description="Settings allow own-use certificates. Gives an OGSERC/REG/{year}/I-CPT number from the year's registration series and issues CERT-01."
              blockers={registrationBlockers.filter((r) => !r.includes("no written override"))}
              action={registerOwnUseAction.bind(null, id)}
              submitLabel="Register"
            >
              <ApproveFields needsOverride={needsOverride} current={row.flagOverrideReason ?? ""} />
            </WorkflowAction>
          ) : (
            <p className="text-sm text-gray-600">
              Not registered. An approving officer registers it once the fee is confirmed and the
              documents are complete.
            </p>
          )}
          {d.documents.length > 0 && (
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="py-1 pr-2 font-normal">Document</th>
                  <th className="py-1 pr-2 font-normal">Generated</th>
                  <th className="py-1 font-normal">File</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {d.documents.map((doc) => (
                  <tr key={doc.id} className={doc.supersededAt ? "text-gray-400" : ""}>
                    <td className="py-1.5 pr-2">
                      {DOCUMENT_LABELS[doc.kind]} v{doc.version}
                      {doc.note && <span className="block text-xs text-gray-500">{doc.note}</span>}
                    </td>
                    <td className="py-1.5 pr-2">{when(doc.createdAt)}</td>
                    <td className="py-1.5">
                      <a className="text-brand-700 underline" href={`/documents/${doc.id}`}>
                        {doc.fileName}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}

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
                <span className="text-gray-500">{when(e.timestamp)}</span>
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
