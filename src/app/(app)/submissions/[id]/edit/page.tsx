import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { can } from "@/domain/roles";
import { isClosed } from "@/domain/types";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { loadFormOptions } from "@/server/options";
import { toIsoDate } from "@/server/reference-data";
import { STATUS_FROM_DB } from "@/server/submissions";
import { updateSubmissionAction } from "../../actions";
import { SubmissionForm } from "../../submission-form";

export default async function EditSubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("records.read");
  const { id } = await params;
  const [row, options] = await Promise.all([
    db.submission.findUnique({ where: { id } }),
    loadFormOptions(db),
  ]);
  if (!row) notFound();
  // Open: registry editing. Closed: Admin only, with a reason (docs/DECISIONS.md).
  const status = STATUS_FROM_DB[row.status];
  const closed = isClosed(status);
  if (!can(user.roles, closed ? "submission.editClosed" : "submission.edit"))
    redirect("/forbidden");

  const s = (v: string | null) => v ?? "";
  const initial = {
    registeredName: row.registeredName,
    dateSubmitted: toIsoDate(row.dateSubmitted),
    submissionChannel: s(row.submissionChannel),
    registrantType: s(row.registrantType),
    cacNo: s(row.cacNo),
    tin: s(row.tin),
    address: s(row.address),
    principalLga: row.principalLga,
    otherAreasServed: s(row.otherAreasServed),
    primaryActivityCode: row.primaryActivityCode,
    secondaryActivityCode: s(row.secondaryActivityCode),
    installedCapacityMw: row.installedCapacityMw?.toString() ?? "",
    customers: row.customers?.toString() ?? "",
    licenceStatus: row.licenceStatus,
    licenceNo: s(row.licenceNo),
    licenceExpiry: s(toIsoDate(row.licenceExpiry)),
    complianceOfficer: s(row.complianceOfficer),
    phone: s(row.phone),
    email: s(row.email),
    operatingOnEffectiveDate: row.operatingOnEffectiveDate ? "Y" : "N",
    plannedStartDate: s(toIsoDate(row.plannedStartDate)),
    categoryOverride: s(row.categoryOverride),
    overrideReason: s(row.overrideReason),
    remarks: s(row.remarks),
  };

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
        initial={initial}
        closedStatus={closed ? status : undefined}
      />
    </div>
  );
}
