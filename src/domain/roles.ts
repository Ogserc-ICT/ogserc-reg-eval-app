// SPEC §5 roles and permissions. A user may hold several roles; permissions are the union.

export const ROLES = [
  "REGISTRY_OFFICER",
  "FINANCE_OFFICER",
  "EVALUATING_OFFICER",
  "REVIEWING_SUPERVISOR",
  "APPROVING_OFFICER",
  "ADMIN",
  "VIEWER",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  REGISTRY_OFFICER: "Registry Officer",
  FINANCE_OFFICER: "Finance Officer",
  EVALUATING_OFFICER: "Evaluating Officer",
  REVIEWING_SUPERVISOR: "Reviewing Supervisor",
  APPROVING_OFFICER: "Approving Officer",
  ADMIN: "Admin",
  VIEWER: "Viewer",
};

export type Permission =
  | "records.read"
  | "dashboard.read"
  | "submission.create"
  | "submission.edit"
  | "fees.waiver"
  | "documents.edit"
  | "payment.record"
  | "payment.verify"
  | "payment.reverse"
  | "ownUse.create"
  | "letter.acknowledgement"
  | "evaluation.editChecks"
  | "submission.markComplete"
  | "deficiency.draft"
  | "evaluation.review"
  | "evaluation.assign"
  | "showCause.record"
  | "deficiency.issue"
  | "submission.lapse"
  | "submission.approve"
  | "submission.refuse"
  | "submission.cancel"
  | "admin.users"
  | "admin.settings"
  | "admin.referenceData"
  | "pricing.recalculate"
  | "submission.editClosed"
  | "decision.reopen"
  | "certificate.reissue"
  | "dailyReview.run"
  | "audit.read"
  | "register.import";

const ALL_STAFF: Permission[] = ["records.read", "dashboard.read"];

const MATRIX: Record<Role, Permission[]> = {
  REGISTRY_OFFICER: [
    "submission.create",
    "submission.edit",
    "documents.edit",
    "payment.record",
    "ownUse.create",
    "letter.acknowledgement",
  ],
  FINANCE_OFFICER: ["payment.record", "payment.verify", "payment.reverse", "fees.waiver"],
  EVALUATING_OFFICER: ["evaluation.editChecks", "submission.markComplete", "deficiency.draft"],
  REVIEWING_SUPERVISOR: [
    "evaluation.review",
    "evaluation.assign",
    "showCause.record",
    "evaluation.editChecks",
    "deficiency.issue",
    "submission.lapse",
    "dailyReview.run",
  ],
  APPROVING_OFFICER: ["submission.approve", "submission.refuse", "showCause.record"],
  ADMIN: [
    "admin.users",
    "admin.settings",
    "admin.referenceData",
    "submission.cancel",
    "payment.reverse",
    "pricing.recalculate",
    "fees.waiver",
    "submission.editClosed",
    "decision.reopen",
    "evaluation.assign",
    "certificate.reissue",
    "dailyReview.run",
    "audit.read",
    "register.import",
  ],
  VIEWER: [],
};

export function permissionsFor(roles: readonly Role[]): Set<Permission> {
  const set = new Set<Permission>(roles.length ? ALL_STAFF : []);
  for (const role of roles) for (const p of MATRIX[role]) set.add(p);
  return set;
}

export function can(roles: readonly Role[], permission: Permission): boolean {
  return permissionsFor(roles).has(permission);
}

/**
 * Only the assigned evaluating officer, or a reviewing supervisor, can edit a submission's checks (§5).
 */
export function canEditChecks(
  user: { id: string; roles: readonly Role[] },
  evaluatingOfficerId: string | null,
): boolean {
  if (user.roles.includes("REVIEWING_SUPERVISOR")) return true;
  return user.roles.includes("EVALUATING_OFFICER") && user.id === evaluatingOfficerId;
}

/** Officer drop-downs are filtered by role (§5). */
export const OFFICER_ROLE = {
  evaluatingOfficerId: "EVALUATING_OFFICER",
  reviewingSupervisorId: "REVIEWING_SUPERVISOR",
  approvingOfficerId: "APPROVING_OFFICER",
} as const satisfies Record<string, Role>;

export function eligibleOfficers<U extends { roles: readonly Role[]; active: boolean }>(
  users: readonly U[],
  role: Role,
): U[] {
  return users.filter((u) => u.active && u.roles.includes(role));
}
