import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { can } from "@/domain/roles";
import { isClosed } from "@/domain/types";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { loadFormOptions } from "@/server/options";
import { submissionFormValues } from "@/server/submission-form-values";
import { childrenInclude } from "@/server/submission-text";
import { STATUS_FROM_DB } from "@/server/submissions";
import { updateSubmissionAction } from "../../actions";
import { SubmissionForm } from "../../submission-form";

export default async function EditSubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("records.read");
  const { id } = await params;
  const [row, options] = await Promise.all([
    db.submission.findUnique({
      where: { id },
      include: { ...childrenInclude, linkedSubmission: { select: { registrationNo: true } } },
    }),
    loadFormOptions(db),
  ]);
  if (!row) notFound();
  // Open: registry editing. Closed: Admin only, with a reason (docs/DECISIONS.md).
  const status = STATUS_FROM_DB[row.status];
  const closed = isClosed(status);
  if (!can(user.roles, closed ? "submission.editClosed" : "submission.edit"))
    redirect("/forbidden");

  return (
    <div>
      <PageHeader
        title={`Edit ${row.ackNo}`}
        back={{ href: `/submissions/${id}`, label: row.registeredName }}
      />
      <p className="mb-4 max-w-3xl text-sm text-gray-600">
        Changes are recorded in the audit log. Saved pricing is not changed here: if an edit affects
        the category, fees or deadline, the record shows “pricing out of date” until an admin
        recalculates.
      </p>
      <SubmissionForm
        mode="edit"
        action={updateSubmissionAction.bind(null, id)}
        options={options}
        initial={submissionFormValues(row, row.linkedSubmission?.registrationNo ?? null)}
        closedStatus={closed ? status : undefined}
      />
    </div>
  );
}
