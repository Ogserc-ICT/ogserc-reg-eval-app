import Link from "next/link";
import { notFound } from "next/navigation";
import { FlagList, PaymentBadge, SlaBadge, StatusBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { Facts, Panel } from "@/components/panel";
import { formatNaira } from "@/domain/money";
import { can } from "@/domain/roles";
import { isClosed } from "@/domain/types";
import { db } from "@/lib/db";
import { nairaInput, showDate, showMoney, showText } from "@/lib/format";
import { requirePermission } from "@/lib/session";
import { toIsoDate } from "@/server/reference-data";
import { listDocuments } from "@/server/documents";
import { getSubmissionDetail } from "@/server/register";
import { PaymentsTable } from "../../payments/payments-table";
import { recalculateAction, setWaiverAction, updateDocumentsAction } from "../actions";
import { DocumentsPanel } from "./documents-panel";
import { DocumentsForm, RecalculateForm, WaiverForm } from "./record-forms";

const NOTICES: Record<string, string> = {
  created: "Submission saved. The acknowledgement letter is under Issued documents below.",
  updated: "Changes saved.",
  payment: "Payment recorded.",
};

export default async function SubmissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const user = await requirePermission("records.read");
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const d = await getSubmissionDetail(db, id);
  if (!d) notFound();
  const documents = await listDocuments(db, id);
  const { row, sub, assessment: a, flags, evaluation } = d;
  const p = a.pricing;
  // Open records follow the usual roles; closed ones are Admin-only, with a reason (docs/DECISIONS.md).
  const closed = isClosed(sub.status);
  const editable = (permission: Parameters<typeof can>[1]) =>
    can(user.roles, closed ? "submission.editClosed" : permission);
  const docsEditable = editable("documents.edit");

  return (
    <div className="space-y-4">
      <PageHeader title={row.registeredName} back={{ href: "/submissions", label: "Register" }}>
        <div className="flex gap-2">
          {editable("submission.edit") && (
            <Link
              href={`/submissions/${id}/edit`}
              className="border-brand-700 text-brand-700 hover:bg-brand-50 rounded border px-3 py-1.5 text-sm"
            >
              Edit details
            </Link>
          )}
          {can(user.roles, "payment.record") && (
            <Link
              href={`/payments/new?reference=${encodeURIComponent(row.ackNo)}&returnTo=${encodeURIComponent(`/submissions/${id}`)}`}
              className="bg-brand-700 hover:bg-brand-800 rounded px-3 py-1.5 text-sm font-medium text-white"
            >
              Record payment
            </Link>
          )}
        </div>
      </PageHeader>

      {row.certificateNeedsReissue && (
        <p
          role="alert"
          className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950"
        >
          A field printed on the certificate has changed since it was issued. The certificate needs
          to be reissued.
        </p>
      )}

      {notice && NOTICES[notice] && (
        <p
          role="status"
          className="border-brand-100 bg-brand-50 text-brand-800 rounded border px-3 py-2 text-sm"
        >
          {NOTICES[notice]}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-mono">{row.ackNo}</span>
        <StatusBadge status={sub.status!} />
        <span>
          Registration no. in use: <strong>{showText(a.registrationNoInUse)}</strong>
        </span>
        <span className="flex items-center gap-1">
          SLA <SlaBadge sla={a.sla} />
        </span>
      </div>

      <section
        aria-label="Next action"
        className="border-gold-500 rounded border-l-4 bg-white px-4 py-3 shadow-xs"
      >
        <p className="text-xs tracking-wide text-gray-500 uppercase">Next action</p>
        <p className="text-brand-900 font-medium">{d.nextAction}</p>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={`Data flags (${flags.length})`}>
          <FlagList flags={flags} />
        </Panel>

        <Panel title="Dates and clocks">
          <Facts
            items={[
              ["Date submitted", showDate(sub.dateSubmitted)],
              ["Registration deadline", showDate(a.registrationDeadline)],
              ["Days late", a.daysLate ? `${a.daysLate} days` : "On time"],
              ["Days in queue", showText(a.daysInQueue)],
              [
                "Submission complete",
                sub.dateSubmissionComplete
                  ? showDate(sub.dateSubmissionComplete)
                  : a.submissionComplete
                    ? "Yes – date not yet entered"
                    : "No",
              ],
              ["Determination due (13(1))", showDate(a.determinationDue)],
              ["Deficiency notice", showDate(sub.deficiencyNoticeDate)],
              ["Response due (13(1)(b))", showDate(a.deficiencyResponseDue)],
              ["Licence application due (18(1))", showDate(a.licenceApplicationDue)],
              ["Certificate issued", showDate(sub.certificateIssueDate)],
            ]}
          />
        </Panel>

        <Panel title="Category and pricing">
          <Facts
            items={[
              [
                "Category applied",
                a.categoryApplied ? `${a.categoryApplied} – ${a.categoryDescription}` : "—",
              ],
              ["Category from activity map", showText(a.categoryAuto)],
              [
                "Primary / secondary activity",
                `${showText(a.primaryCode)} / ${showText(a.secondaryCode)}`,
              ],
              ["Override reason", showText(sub.overrideReason)],
              ["Registration fee", showMoney(p?.registrationFee)],
              [
                "Late charge terms",
                p
                  ? `${formatNaira(p.lateInitial)} + ${formatNaira(p.lateDaily)}/day, cap ${formatNaira(p.lateDailyCap)}`
                  : "—",
              ],
              ["Priced under Effective Date", showDate(p?.effectiveDate)],
              ["Priced on", row.pricedAt.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" })],
            ]}
          />
          {a.pricingChanges.length > 0 && (
            <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950">
              <p className="font-medium">Current rules would price this differently:</p>
              <ul className="ml-4 list-disc">
                {a.pricingChanges.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {can(user.roles, "pricing.recalculate") &&
            a.pricingChanges.length > 0 &&
            !sub.registrationNo && <RecalculateForm action={recalculateAction.bind(null, id)} />}
        </Panel>

        <Panel title="Fees (Schedule 3)">
          <Facts
            items={[
              ["Registration fee", showMoney(a.fees.fee)],
              ["Late charge", showMoney(a.fees.lateCharge)],
              ["Approved waiver", showMoney(sub.approvedWaiver)],
              ["Total due", <strong key="t">{showMoney(a.fees.totalDue)}</strong>],
              ["Paid", showMoney(a.fees.amountPaid)],
              ["Balance", showMoney(a.fees.balance)],
              ["Payment status", <PaymentBadge key="s" status={a.fees.paymentStatus} />],
              ["Last payment", showDate(a.fees.lastPaymentDate)],
            ]}
          />
          {editable("fees.waiver") && (
            <WaiverForm
              action={setWaiverAction.bind(null, id)}
              current={nairaInput(sub.approvedWaiver)}
            />
          )}
        </Panel>
      </div>

      <DocumentsPanel
        submissionId={id}
        documents={documents}
        roles={user.roles}
        registered={sub.status === "Registered"}
        open={!closed}
        needsReissue={row.certificateNeedsReissue}
      />

      <Panel title="Payments">
        <PaymentsTable rows={d.payments} roles={user.roles} showReference={false} />
      </Panel>

      {d.deficiencyNotices.length > 0 && (
        <Panel title="Deficiency notices (para 13(1)(b))">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-gray-500">
              <tr>
                <th className="py-1 pr-2 font-normal">Notice</th>
                <th className="py-1 pr-2 font-normal">Issued</th>
                <th className="py-1 pr-2 font-normal">Response due</th>
                <th className="py-1 pr-2 font-normal">Response received</th>
                <th className="py-1 font-normal">Issued by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {d.deficiencyNotices.map((n) => (
                <tr key={n.id}>
                  <td className="py-1.5 pr-2 font-mono">{n.noticeRef}</td>
                  <td className="py-1.5 pr-2">{showDate(toIsoDate(n.noticeDate))}</td>
                  <td className="py-1.5 pr-2">{showDate(toIsoDate(n.responseDue))}</td>
                  <td className="py-1.5 pr-2">
                    {n.responseReceivedDate
                      ? showDate(toIsoDate(n.responseReceivedDate))
                      : "Not yet"}
                  </td>
                  <td className="py-1.5">{n.issuedBy.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel
        title={`Documents (${a.documents.outstanding} outstanding, ${a.documents.pending} pending)`}
      >
        {docsEditable ? (
          <DocumentsForm
            action={updateDocumentsAction.bind(null, id)}
            documents={d.documents}
            closedStatus={closed ? sub.status! : undefined}
          />
        ) : (
          <ul className="space-y-1 text-sm">
            {d.documents.map((doc) => (
              <li key={doc.number} className="flex justify-between gap-4">
                <span>{doc.name}</span>
                <span className="text-gray-600">
                  {doc.value === "Y"
                    ? "Received"
                    : doc.value === "N"
                      ? "Outstanding"
                      : doc.value === "N/A"
                        ? "N/A"
                        : "Pending"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Registrant details">
          <Facts
            items={[
              ["Registrant type", showText(sub.registrantType)],
              ["Submission channel", showText(sub.submissionChannel)],
              ["CAC number", showText(sub.cacNo)],
              ["TIN", showText(sub.tin)],
              ["Address", showText(sub.address)],
              ["Principal LGA", showText(sub.principalLga)],
              ["Other areas served", showText(sub.otherAreasServed)],
              [
                "Installed capacity",
                sub.installedCapacityMw === null ? "—" : `${sub.installedCapacityMw} MW`,
              ],
              ["Customers", showText(sub.customers?.toLocaleString("en-NG"))],
              [
                "Licence",
                `${showText(sub.licenceStatus)}${sub.licenceNo ? `, No. ${sub.licenceNo}` : ""}`,
              ],
              ["Licence expiry", showDate(sub.licenceExpiry)],
              [
                "Operating on Effective Date",
                sub.operatingOnEffectiveDate === "Y"
                  ? "Yes"
                  : `No – planned start ${showDate(sub.plannedStartDate)}`,
              ],
              ["Compliance officer", showText(sub.complianceOfficer)],
              ["Phone / email", `${showText(sub.phone)} / ${showText(sub.email)}`],
              ["Entered by", row.createdBy.name],
              ["Remarks", showText(sub.remarks)],
            ]}
          />
        </Panel>

        <Panel title="Evaluation (EVAL-01)">
          <Facts
            items={[
              ["Status", evaluation.status],
              ["Recommended outcome", evaluation.recommended],
              ["Final decision", showText(evaluation.finalDecision)],
              [
                "Checks",
                `${evaluation.counts.satisfied} satisfied, ${evaluation.counts.failed} failed, ${evaluation.counts.na} N/A, ${evaluation.counts.pending} pending of ${evaluation.counts.total}`,
              ],
              ["Evaluating officer", showText(evaluation.evaluatingOfficer)],
              ["Reviewing supervisor", showText(evaluation.reviewingSupervisor)],
              ["Approving officer", showText(evaluation.approvingOfficer)],
            ]}
          />
          <Link
            href={`/submissions/${id}/evaluation`}
            className="bg-brand-700 hover:bg-brand-800 mt-3 inline-block rounded px-3 py-1.5 text-sm font-medium text-white"
          >
            Open evaluation (EVAL-01)
          </Link>
        </Panel>
      </div>

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
        <p className="mt-2 text-xs text-gray-500">Times are Lagos time.</p>
      </Panel>
    </div>
  );
}
