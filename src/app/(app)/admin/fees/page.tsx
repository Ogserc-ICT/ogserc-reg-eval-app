import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { loadReferenceData } from "@/server/reference-data";
import { updateFeeTableAction } from "../actions";
import { FeeTableForm } from "./fee-table-form";

export default async function FeeTablePage() {
  await requirePermission("admin.referenceData");
  const { fees } = await loadReferenceData(db);
  return (
    <div className="max-w-6xl">
      <PageHeader title="Fee table (Schedule 3)" back={{ href: "/admin", label: "Admin" }} />
      <div className="mb-4 max-w-3xl space-y-1 text-sm text-gray-700">
        <p>
          New submissions are priced with this table. Submissions and own-use notifications already
          saved keep the pricing they were saved with; any whose pricing now differs show
          &ldquo;pricing out of date&rdquo; until an admin recalculates them (with a reason).
        </p>
        <p>
          Late charge = initial + the lesser of (per day × days late) and the daily cap. Remember to
          update &ldquo;Fees revised on&rdquo; in Settings.
        </p>
      </div>
      <FeeTableForm fees={fees} action={updateFeeTableAction} />
    </div>
  );
}
