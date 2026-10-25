import { formatDate } from "./dates";
import { formatNaira } from "./money";
import type { Role } from "./roles";
import type { IsoDate } from "./types";

// Who is told what when the workflow moves on (docs/DECISIONS.md, Notifications). The rule is "notify
// the next person in line": the officer assigned to the next step, or everyone holding that role
// when nobody is assigned yet. The server leaves out the user who caused the event and inactive users.

/** The submission an event is about, with the people attached to it. */
export interface SubmissionSubject {
  id: string;
  ackNo: string;
  name: string;
  createdById: string | null;
  evaluatingOfficerId: string | null;
  reviewingSupervisorId: string | null;
  approvingOfficerId: string | null;
}

export type OfficerField = "evaluatingOfficerId" | "reviewingSupervisorId" | "approvingOfficerId";

export type Outcome = "Registered" | "Refused" | "Lapsed" | "Cancelled" | "Changes Applied";

export type NotificationEvent =
  | { kind: "submissionCreated"; sub: SubmissionSubject }
  | { kind: "ownUseCreated"; id: string; ounNo: string; name: string; fee: number }
  | { kind: "paymentRecorded"; paymentNo: string; reference: string; amount: number }
  | {
      kind: "paymentRejected";
      paymentNo: string;
      reference: string;
      recordedById: string;
      reason: string;
      href: string;
    }
  | { kind: "released"; sub: SubmissionSubject }
  | {
      kind: "officersAssigned";
      sub: SubmissionSubject;
      assigned: Partial<Record<OfficerField, string>>;
    }
  | { kind: "submissionComplete"; sub: SubmissionSubject; determinationDue: IsoDate | null }
  | { kind: "reviewed"; sub: SubmissionSubject }
  | { kind: "deficiencyIssued"; sub: SubmissionSubject; responseDue: IsoDate }
  | { kind: "decided"; sub: SubmissionSubject; outcome: Outcome }
  | { kind: "provisional"; sub: SubmissionSubject };

/** Specific users, plus every active holder of the roles. */
export interface Audience {
  userIds: string[];
  roles: Role[];
}

export interface NotificationPlan {
  audience: Audience;
  title: string;
  body: string;
  href: string;
  reference: string;
}

const users = (...ids: (string | null)[]): Audience => ({
  userIds: ids.filter((id): id is string => !!id),
  roles: [],
});
const role = (...roles: Role[]): Audience => ({ userIds: [], roles });
/** The assigned officer, or everyone with the role while nobody is assigned. */
const assignedOr = (userId: string | null, fallback: Role): Audience =>
  userId ? users(userId) : role(fallback);

const subjectLine = (sub: SubmissionSubject) => `${sub.ackNo} – ${sub.name}`;
const page = (sub: SubmissionSubject) => `/submissions/${sub.id}`;
const evaluationPage = (sub: SubmissionSubject) => `/submissions/${sub.id}/evaluation`;

const ASSIGNED_AS: Record<OfficerField, string> = {
  evaluatingOfficerId: "evaluating officer",
  reviewingSupervisorId: "reviewing supervisor",
  approvingOfficerId: "approving officer",
};

/** The notifications an event produces (none when nobody needs to act or know). */
export function planNotifications(event: NotificationEvent): NotificationPlan[] {
  switch (event.kind) {
    case "submissionCreated":
      return [
        {
          audience: role("FINANCE_OFFICER"),
          title: "New submission awaiting payment",
          body: subjectLine(event.sub),
          href: page(event.sub),
          reference: event.sub.ackNo,
        },
      ];

    case "ownUseCreated":
      if (event.fee <= 0) return [];
      return [
        {
          audience: role("FINANCE_OFFICER"),
          title: "New own-use notification awaiting payment",
          body: `${event.ounNo} – ${event.name} (fee ${formatNaira(event.fee)})`,
          href: `/own-use/${event.id}`,
          reference: event.ounNo,
        },
      ];

    case "paymentRecorded":
      return [
        {
          audience: role("FINANCE_OFFICER"),
          title: "Payment to confirm",
          body: `${event.paymentNo}: ${formatNaira(event.amount)} for ${event.reference}`,
          href: "/finance",
          reference: event.reference,
        },
      ];

    case "paymentRejected":
      return [
        {
          audience: users(event.recordedById),
          title: "Payment rejected by Finance",
          body: `${event.paymentNo} for ${event.reference}. Reason: ${event.reason}`,
          href: event.href,
          reference: event.reference,
        },
      ];

    case "released": {
      const { sub } = event;
      // With an evaluator already chosen, evaluation can start; otherwise a supervisor assigns one.
      return [
        sub.evaluatingOfficerId
          ? {
              audience: users(sub.evaluatingOfficerId),
              title: "Ready for evaluation",
              body: `Payment confirmed. ${subjectLine(sub)}`,
              href: evaluationPage(sub),
              reference: sub.ackNo,
            }
          : {
              audience: role("REVIEWING_SUPERVISOR"),
              title: "Payment confirmed: assign officers",
              body: subjectLine(sub),
              href: evaluationPage(sub),
              reference: sub.ackNo,
            },
      ];
    }

    case "officersAssigned":
      return (Object.entries(event.assigned) as [OfficerField, string][]).map(
        ([field, userId]) => ({
          audience: users(userId),
          title: `You are the ${ASSIGNED_AS[field]}`,
          body: subjectLine(event.sub),
          href: evaluationPage(event.sub),
          reference: event.sub.ackNo,
        }),
      );

    case "submissionComplete":
      return [
        {
          audience: assignedOr(event.sub.reviewingSupervisorId, "REVIEWING_SUPERVISOR"),
          title: "Ready for review",
          body:
            subjectLine(event.sub) +
            (event.determinationDue
              ? `. Determination due ${formatDate(event.determinationDue)}`
              : ""),
          href: evaluationPage(event.sub),
          reference: event.sub.ackNo,
        },
      ];

    case "reviewed":
      return [
        {
          audience: assignedOr(event.sub.approvingOfficerId, "APPROVING_OFFICER"),
          title: "Ready for decision",
          body: subjectLine(event.sub),
          href: evaluationPage(event.sub),
          reference: event.sub.ackNo,
        },
      ];

    case "deficiencyIssued":
      return [
        {
          audience: users(event.sub.createdById, event.sub.evaluatingOfficerId),
          title: "Deficiency notice issued",
          body: `${subjectLine(event.sub)}. Response due ${formatDate(event.responseDue)}`,
          href: page(event.sub),
          reference: event.sub.ackNo,
        },
      ];

    case "decided":
      return [
        {
          audience: users(
            event.sub.createdById,
            event.sub.evaluatingOfficerId,
            event.sub.reviewingSupervisorId,
            event.sub.approvingOfficerId,
          ),
          title: event.outcome,
          body: subjectLine(event.sub),
          href: page(event.sub),
          reference: event.sub.ackNo,
        },
      ];

    case "provisional":
      return [
        {
          audience: {
            userIds: users(event.sub.reviewingSupervisorId, event.sub.approvingOfficerId).userIds,
            roles:
              event.sub.reviewingSupervisorId || event.sub.approvingOfficerId
                ? []
                : ["REVIEWING_SUPERVISOR", "APPROVING_OFFICER"],
          },
          title: "Provisionally registered (para 13(4))",
          body: `${subjectLine(event.sub)}. The determination period passed with no decision`,
          href: evaluationPage(event.sub),
          reference: event.sub.ackNo,
        },
      ];
  }
}
