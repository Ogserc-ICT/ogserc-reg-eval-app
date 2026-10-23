import { PageHeader } from "@/components/page-header";
import { appToday } from "@/server/clock";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { loadFormOptions } from "@/server/options";
import { createSubmissionAction } from "../actions";
import { SubmissionForm } from "../submission-form";

export default async function NewSubmissionPage() {
  await requirePermission("submission.create");
  const options = await loadFormOptions(db);
  return (
    <div>
      <PageHeader
        title="New submission (REG-01)"
        back={{ href: "/submissions", label: "Register" }}
      />
      <p className="mb-4 max-w-3xl text-sm text-gray-600">
        Saving assigns the acknowledgement number and fixes the category, fees and deadline under
        the current fee table and Settings.
      </p>
      <SubmissionForm
        mode="create"
        action={createSubmissionAction}
        options={options}
        initial={{ dateSubmitted: appToday(), operatingOnEffectiveDate: "Y" }}
      />
    </div>
  );
}
