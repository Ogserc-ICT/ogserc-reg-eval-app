import Link from "next/link";
import { notFound } from "next/navigation";
import { FlagList, PaymentBadge, SlaBadge, StatusBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { Facts, Panel } from "@/components/panel";
import { serviceAreaText } from "@/domain/certificate";
import { CONDITION_KEYS, CONDITION_LABELS } from "@/domain/forms";
import { formatNaira } from "@/domain/money";
import { can } from "@/domain/roles";
import { FILING_LABELS, STATUS, isClosed, isLinkedFiling } from "@/domain/types";
import { db } from "@/lib/db";
import { documentStatusText, nairaInput, showDate, showMoney, showText } from "@/lib/format";
import {
  claimsText,
  directorsText,
  incidentsText,
  licencesText,
  shareholdersText,
  signatoriesText,
} from "@/server/submission-text";
import { STATUS_FROM_DB } from "@/server/submissions";
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
  const x = d.details;
  const linkedFiling = isLinkedFiling(sub.filingType);
  const canFile =
    can(user.roles, "submission.create") &&
    sub.filingType === "NEW" &&
    sub.status === STATUS.REGISTERED &&
    !!sub.registrationNo;
  const fileHref = (type: "UPDATE" | "ANNUAL") =>
    `/submissions/new?filing=${type}&reg=${encodeURIComponent(sub.registrationNo ?? "")}`;

  return (
    <div className="space-y-4">
      <PageHeader title={row.registeredName} back={{ href: "/submissions", label: "Register" }}>
        <div className="flex flex-wrap gap-2">
          {canFile && (
            <>
              <Link
                href={fileHref("UPDATE")}
                className="border-brand-700 text-brand-700 hover:bg-brand-50 rounded border px-3 py-1.5 text-sm"
              >
                File an update
              </Link>
              <Link
                href={fileHref("ANNUAL")}
                className="border-brand-700 text-brand-700 hover:bg-brand-50 rounded border px-3 py-1.5 text-sm"
              >
                File annual confirmation
              </Link>
            </>
          )}
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
          Stage {a.processStage.stage}: <strong>{a.processStage.label}</strong>
        </span>
        <span>
          Registration no. in use: <strong>{showText(a.registrationNoInUse)}</strong>
        </span>
        <span className="flex items-center gap-1">
          SLA <SlaBadge sla={a.sla} />
        </span>
      </div>
      <p className="text-sm text-gray-700">
        {FILING_LABELS[sub.filingType]} on Form <strong>{showText(sub.formFiled)}</strong>
        {x.linkedSubmission && (
          <>
            {" "}
            for{" "}
            <Link
              className="text-brand-700 underline"
              href={`/submissions/${x.linkedSubmission.id}`}
            >
              {x.linkedSubmission.registrationNo ?? x.linkedSubmission.ackNo}
            </Link>
          </>
        )}
      </p>

      <section
        aria-label="Next action"
        className="border-gold-500 rounded border-l-4 bg-white px-4 py-3 shadow-xs"
      >
        <p className="text-xs tracking-wide text-gray-500 uppercase">Next action</p>
        <p className="text-brand-900 font-medium">{d.nextAction}</p>
      </section>

      {linkedFiling && d.filingChanges && (
        <Panel
          title={
            sub.status === STATUS.APPLIED
              ? "Changes applied to the registration"
              : `Changes to apply on approval (${d.filingChanges.length})`
          }
        >
          {sub.status === STATUS.APPLIED ? (
            <p className="text-sm text-gray-700">
              Applied on approval. The registration’s history lists each old and new value.
            </p>
          ) : d.filingChanges.length ? (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="py-1 pr-2 font-normal">Field</th>
                  <th className="py-1 pr-2 font-normal">Registered now</th>
                  <th className="py-1 font-normal">After approval</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {d.filingChanges.map((c) => (
                  <tr key={c.key}>
                    <td className="py-1.5 pr-2">
                      {c.label}
                      {c.certificate && (
                        <span className="block text-xs text-amber-800">On the certificate</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-gray-600">{showText(c.before)}</td>
                    <td className="py-1.5">{showText(c.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-700">
              No changes: approving it confirms the registered details as they are.
            </p>
          )}
        </Panel>
      )}

      {d.linkedFilings.length > 0 && (
        <Panel title="Updates and annual confirmations">
          <ul className="space-y-1 text-sm">
            {d.linkedFilings.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3">
                <Link className="text-brand-700 font-mono underline" href={`/submissions/${f.id}`}>
                  {f.ackNo}
                </Link>
                <span>{FILING_LABELS[f.filingType]}</span>
                <span className="text-gray-600">{showDate(toIsoDate(f.dateSubmitted))}</span>
                <StatusBadge status={STATUS_FROM_DB[f.status]} />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={`Data flags (${flags.length})`}>
          <FlagList flags={flags} />
        </Panel>

        <Panel title="Dates and clocks">
          <Facts
            items={[
              ["Date submitted", showDate(sub.dateSubmitted)],
              ["Released for evaluation", showDate(sub.releasedForEvaluationDate)],
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
              ["Form filed", showText(sub.formFiled)],
              [
                "Category confirmed",
                sub.confirmedCategory
                  ? `${sub.confirmedCategory}${x.categoryConfirmedBy ? ` by ${x.categoryConfirmedBy.name}` : ""}${x.categoryConfirmedOn ? `, ${showDate(toIsoDate(x.categoryConfirmedOn))}` : ""}${sub.categoryConfirmedReason ? ` – ${sub.categoryConfirmedReason}` : ""}`
                  : "Not yet (evaluation)",
              ],
              [
                "Primary / other activities",
                `${showText(a.primaryCode)} / ${a.otherCodes.join(", ") || "none"}`,
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
              ["Paid (confirmed by Finance)", showMoney(a.fees.amountPaid)],
              [
                "With Finance (pending)",
                a.financeGate.pendingCount
                  ? `${showMoney(a.financeGate.pending)} (${a.financeGate.pendingCount} payment${a.financeGate.pendingCount === 1 ? "" : "s"})`
                  : "—",
              ],
              ["Balance", showMoney(a.fees.balance)],
              [
                "Required for evaluation",
                <span key="g">
                  {showMoney(a.financeGate.required)}{" "}
                  <span className="text-gray-600">
                    {a.financeGate.cleared ? "· confirmed" : "· not yet confirmed"}
                  </span>
                </span>,
              ],
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
        registered={sub.status === STATUS.REGISTERED}
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
        title={`Documents – ${showText(a.documentsForm)} (${a.documents.outstanding} outstanding, ${a.documents.pending} pending)`}
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
              <li key={doc.key} className="flex justify-between gap-4">
                <span>{doc.text}</span>
                <span className="text-gray-600">{documentStatusText(doc)}</span>
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
              ["Trading name", showText(x.tradingName)],
              ["Submission channel", showText(sub.submissionChannel)],
              ["CAC number", showText(sub.cacNo)],
              ["Date of incorporation", showDate(toIsoDate(x.incorporationDate))],
              ["TIN", showText(sub.tin)],
              ["Registered address", showText(sub.address)],
              ["Operational address", showText(x.operationalAddress)],
              ["Website", showText(x.website)],
              ["Service area", serviceAreaText(sub)],
              [
                "Installed capacity",
                sub.installedCapacityMw === null ? "—" : `${sub.installedCapacityMw} MW`,
              ],
              ["Customers", showText(sub.customers?.toLocaleString("en-NG"))],
              ["Licence status", showText(sub.licenceStatus)],
              ["Licences", showText(licencesText(x.licences))],
              ["Nearest licence expiry", showDate(a.nearestLicenceExpiry)],
              [
                "Operating on Effective Date",
                sub.operatingOnEffectiveDate === "Y"
                  ? "Yes"
                  : `No – planned start ${showDate(sub.plannedStartDate)}`,
              ],
              [
                "Managing director",
                [x.mdName, x.mdPhone, x.mdEmail].filter(Boolean).join(", ") || "—",
              ],
              ["Compliance officer", showText(sub.complianceOfficer)],
              ["Phone / email", `${showText(sub.phone)} / ${showText(sub.email)}`],
              ["Shareholders (5%+)", showText(shareholdersText(x.shareholders))],
              ["Directors and key officers", showText(directorsText(x.directors))],
              ["HSE incidents (24 months)", showText(incidentsText(x.hseIncidents))],
              ["Confidentiality claims", showText(claimsText(x.confidentialityClaims))],
              ["Signatories", showText(signatoriesText(x))],
              [
                "Document conditions",
                CONDITION_KEYS.filter((k) => sub.conditions[k])
                  .map((k) => `${CONDITION_LABELS[k]} ${sub.conditions[k] === "Y" ? "Yes" : "No"}`)
                  .join("; ") || "—",
              ],
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
