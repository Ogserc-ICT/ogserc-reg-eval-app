import Link from "next/link";
import { notFound } from "next/navigation";
import { FlagList, StatusBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { Facts, Panel } from "@/components/panel";
import { evaluationProgress, checkIsEditable } from "@/domain/evaluation";
import { formatNaira } from "@/domain/money";
import { nextAction } from "@/domain/next-action";
import { can, canEditChecks, eligibleOfficers, type Role } from "@/domain/roles";
import { STATUS, isClosed } from "@/domain/types";
import {
  REFUSAL_GROUNDS,
  approvalBlockers,
  cancelBlockers,
  deciderProblems,
  deficiencyNoticeCheck,
  lapseBlockers,
  markComplete,
  refusalBlockers,
} from "@/domain/workflow";
import { db } from "@/lib/db";
import { showDate, showText } from "@/lib/format";
import { requirePermission } from "@/lib/session";
import { loadContext } from "@/server/context";
import { loadEvaluationState } from "@/server/evaluation-state";
import { toIsoDate } from "@/server/reference-data";
import {
  approveAction,
  assignOfficersAction,
  cancelAction,
  issueDeficiencyAction,
  lapseAction,
  markCompleteAction,
  recordReviewAction,
  refuseAction,
  reopenAction,
  saveChecksAction,
  showCauseAction,
} from "./actions";
import { ChecksForm } from "./checks-form";
import {
  ApproveFields,
  AssignOfficersForm,
  ReasonField,
  RefuseFields,
  ShowCauseFields,
  WorkflowAction,
} from "./workflow-forms";

const OVERRIDE_MISSING = "with no written override reason";

export default async function EvaluationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("records.read");
  const { id } = await params;
  const ctx = await loadContext(db);
  const state = await loadEvaluationState(db, id, ctx);
  if (!state) notFound();
  const { row, sub, assessment: a, evaluation: ev, counts, flags } = state;
  const { today, settings } = ctx;
  const closed = isClosed(sub.status);
  const roles = user.roles;
  const mayEditChecks =
    can(roles, "evaluation.editChecks") && canEditChecks(user, ev.evaluatingOfficerId);

  // --- Blockers per action (the same rules the actions enforce) ---
  const complete = markComplete(sub, a, today, settings);
  const completeBlockers = closed
    ? [`Submission is closed (${sub.status})`]
    : !complete.ok
      ? [
          ...complete.outstandingDocuments.map((d) => `Outstanding: ${d}`),
          ...(complete.shortfall > 0 ? [`Unpaid: ${formatNaira(complete.shortfall)}`] : []),
        ]
      : !complete.changed && sub.status !== STATUS.DEFICIENCY
        ? [`Already complete since ${showDate(sub.dateSubmissionComplete)}`]
        : [];
  if (!canEditChecks(user, ev.evaluatingOfficerId)) {
    completeBlockers.unshift(
      "Only the assigned evaluating officer or a reviewing supervisor can do this",
    );
  }

  const reviewBlockers = [
    ...(ev.reviewingSupervisorId !== user.id
      ? ["Only the assigned reviewing supervisor can record the review"]
      : []),
    ...(!ev.evaluatingOfficerId ? ["No evaluating officer assigned"] : []),
    ...(ev.finalDecision ? ["A final decision is already recorded"] : []),
  ];

  const deficiency = deficiencyNoticeCheck(sub.status, counts, a.submissionComplete);

  // Approval: if flags can be overridden with a reason, show the field and judge the rest as if given.
  const needsOverride = flags.length > 0 && !settings.policy.flagsBlockApproval;
  const assumedOverride = ev.flagOverrideReason ?? (needsOverride ? "(reason to be given)" : null);
  const approveCounts = state.checksFor(assumedOverride).counts;
  const approveBlockers = approvalBlockers({
    sub,
    assessment: a,
    evaluation: { ...ev, flagOverrideReason: assumedOverride },
    counts: approveCounts,
    flags,
    createdById: row.createdById,
    actorId: user.id,
    settings,
  }).filter((r) => !r.includes(OVERRIDE_MISSING));

  const refuseBlockers = [
    ...refusalBlockers(
      sub.status,
      toIsoDate(row.showCauseDate),
      REFUSAL_GROUNDS[0],
      today,
      settings,
    ),
    ...deciderProblems(ev, row.createdById, user.id),
  ];

  const officers = await db.user.findMany({
    select: { id: true, name: true, roles: true, active: true },
    orderBy: { name: "asc" },
  });
  const pick = (role: Role) =>
    eligibleOfficers(officers, role).map(({ id, name }) => ({ id, name }));

  const checkRows = state.checks.map((c) => ({
    id: c.id,
    stage: c.stage,
    text: c.text,
    value: c.value,
    mode: c.mode,
    editable: checkIsEditable(c, ev.finalDecision, sub.status),
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Evaluation (EVAL-01): ${row.registeredName}`}
        back={{ href: `/submissions/${id}`, label: row.ackNo }}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <StatusBadge status={sub.status!} />
        <span>
          Evaluation: <strong>{state.status}</strong>
        </span>
        <span>
          Recommended: <strong>{state.recommended}</strong>
        </span>
        <span>
          Progress: {Math.round(evaluationProgress(counts) * 100)}% ({counts.satisfied} Y,{" "}
          {counts.failed} N, {counts.na} N/A, {counts.pending} pending of {counts.total})
        </span>
      </div>
      <section
        aria-label="Next action"
        className="border-gold-500 rounded border-l-4 bg-white px-4 py-3"
      >
        <p className="text-xs tracking-wide text-gray-500 uppercase">Next action</p>
        <p className="text-brand-900 font-medium">{nextAction(sub, a, today)}</p>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-4">
          {flags.length > 0 && (
            <Panel title={`Data flags (${flags.length}) – check 7.6`}>
              <FlagList flags={flags} />
            </Panel>
          )}
          <ChecksForm
            action={saveChecksAction.bind(null, id)}
            checks={checkRows}
            remarks={ev.evaluationRemarks ?? ""}
            canEdit={mayEditChecks}
          />
        </div>

        <div className="space-y-4">
          <Panel title="Officers">
            {can(roles, "evaluation.assign") && !ev.finalDecision ? (
              <AssignOfficersForm
                action={assignOfficersAction.bind(null, id)}
                current={{
                  evaluatingOfficerId: ev.evaluatingOfficerId ?? "",
                  reviewingSupervisorId: ev.reviewingSupervisorId ?? "",
                  approvingOfficerId: ev.approvingOfficerId ?? "",
                }}
                options={{
                  evaluatingOfficerId: pick("EVALUATING_OFFICER"),
                  reviewingSupervisorId: pick("REVIEWING_SUPERVISOR"),
                  approvingOfficerId: pick("APPROVING_OFFICER"),
                }}
              />
            ) : (
              <Facts
                columns={1}
                items={[
                  ["Evaluating officer", showText(state.evaluationRow.evaluatingOfficer?.name)],
                  ["Reviewing supervisor", showText(state.evaluationRow.reviewingSupervisor?.name)],
                  ["Approving officer", showText(state.evaluationRow.approvingOfficer?.name)],
                ]}
              />
            )}
            <div className="mt-3 border-t border-gray-100 pt-3">
              <Facts
                columns={1}
                items={[
                  ["Evaluation started", showDate(ev.dateEvaluationStarted)],
                  ["Reviewed", showDate(ev.reviewDate)],
                  ["Final decision", showText(ev.finalDecision)],
                  ["Decision date", showDate(ev.approvalDate)],
                  ["Reasons", showText(ev.reasons)],
                  ["Registration number", showText(a.registrationNoInUse)],
                ]}
              />
            </div>
          </Panel>

          <Panel title="Actions">
            {can(roles, "submission.markComplete") && (
              <WorkflowAction
                title="Mark submission complete"
                description="All documents received or N/A and the fee paid (para 13(1)). Starts the 30-day determination clock."
                blockers={completeBlockers}
                action={markCompleteAction.bind(null, id)}
                submitLabel="Mark complete"
              />
            )}
            {can(roles, "evaluation.review") && (
              <WorkflowAction
                title="Record review"
                description="The reviewing supervisor confirms the evaluation has been reviewed."
                blockers={reviewBlockers}
                action={recordReviewAction.bind(null, id)}
                submitLabel="Record review"
              />
            )}
            {can(roles, "deficiency.issue") && (
              <WorkflowAction
                title="Issue deficiency notice"
                description={`Para 13(1)(b): the applicant has ${settings.deficiencyDays} days to respond.`}
                blockers={deficiency.blockers}
                action={issueDeficiencyAction.bind(null, id)}
                submitLabel="Issue deficiency notice"
              />
            )}
            {can(roles, "submission.approve") && (
              <WorkflowAction
                title="Approve and register"
                description="Para 13(1)(a). Generates and locks the registration number."
                blockers={approveBlockers}
                action={approveAction.bind(null, id)}
                submitLabel="Approve and register"
              >
                <ApproveFields
                  needsOverride={needsOverride && !closed}
                  current={ev.flagOverrideReason ?? ""}
                />
              </WorkflowAction>
            )}
            {can(roles, "submission.lapse") && sub.status === STATUS.DEFICIENCY && (
              <WorkflowAction
                title="Lapse"
                description="Para 13(2): no complete response within the deficiency period."
                blockers={lapseBlockers(sub.status, a, today)}
                action={lapseAction.bind(null, id)}
                submitLabel="Lapse submission"
                tone="danger"
              />
            )}
            {can(roles, "showCause.record") && !closed && (
              <WorkflowAction
                title="Record show-cause notice"
                description={`Paras 13(3), 20: refusal needs a show-cause notice and ${settings.showCauseDays} days to answer.`}
                blockers={[]}
                action={showCauseAction.bind(null, id)}
                submitLabel="Save show-cause date"
              >
                <ShowCauseFields today={today} current={toIsoDate(row.showCauseDate) ?? ""} />
              </WorkflowAction>
            )}
            {can(roles, "submission.refuse") && !closed && (
              <WorkflowAction
                title="Refuse"
                description="Only on a ground the Order allows, after the show-cause period."
                blockers={refuseBlockers}
                action={refuseAction.bind(null, id)}
                submitLabel="Refuse submission"
                tone="danger"
              >
                <RefuseFields grounds={REFUSAL_GROUNDS} />
              </WorkflowAction>
            )}
            {can(roles, "decision.reopen") && closed && (
              <WorkflowAction
                title="Reopen decision"
                description="Admin only. Returns a Refused, Lapsed or Cancelled submission to where the decision found it. A registration cannot be reopened (its number is locked)."
                blockers={
                  sub.status === STATUS.REGISTERED
                    ? [
                        `Registered as ${row.registrationNo}: cancel the registration instead (para 14)`,
                      ]
                    : []
                }
                action={reopenAction.bind(null, id)}
                submitLabel="Reopen decision"
                tone="danger"
              >
                <ReasonField label="Reason for reopening" />
              </WorkflowAction>
            )}
            {can(roles, "submission.cancel") && (
              <WorkflowAction
                title="Cancel"
                description="Admin only (para 14). The record is kept with status Cancelled."
                blockers={cancelBlockers(sub.status, "reason")}
                action={cancelAction.bind(null, id)}
                submitLabel="Cancel submission"
                tone="danger"
              >
                <ReasonField label="Reason for cancelling" />
              </WorkflowAction>
            )}
            <p className="pt-2 text-xs text-gray-500">
              Only actions your roles allow are shown.{" "}
              <Link href={`/submissions/${id}`} className="text-brand-700 hover:underline">
                Back to the submission
              </Link>
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
