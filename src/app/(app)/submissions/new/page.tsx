import { PageHeader } from "@/components/page-header";
import { FILING_LABELS } from "@/domain/types";
import { appToday } from "@/server/clock";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { loadFormOptions } from "@/server/options";
import { filingFormValues } from "@/server/submission-form-values";
import { childrenInclude } from "@/server/submission-text";
import { createSubmissionAction } from "../actions";
import { SubmissionForm } from "../submission-form";

/**
 * New submission on Form REG-01A to K. `?filing=UPDATE|ANNUAL&reg={registration no.}` starts an
 * update or annual confirmation as a copy of that registered record.
 */
export default async function NewSubmissionPage({
  searchParams,
}: {
  searchParams: Promise<{ filing?: string; reg?: string }>;
}) {
  await requirePermission("submission.create");
  const { filing, reg } = await searchParams;
  const options = await loadFormOptions(db);
  const filingType = filing === "UPDATE" || filing === "ANNUAL" ? filing : null;
  const registered =
    filingType && reg
      ? await db.submission.findFirst({
          where: {
            registrationNo: reg.trim().toUpperCase(),
            filingType: "NEW",
            status: "REGISTERED",
          },
          include: childrenInclude,
        })
      : null;

  const initial = registered
    ? filingFormValues(registered, filingType!, appToday())
    : {
        filingType: filingType ?? "NEW",
        linkedRegistrationNo: reg ?? "",
        dateSubmitted: appToday(),
        operatingOnEffectiveDate: "Y",
      };

  return (
    <div>
      <PageHeader
        title={
          registered
            ? `${FILING_LABELS[filingType!]}: ${registered.registeredName}`
            : "New submission (REG-01A to K)"
        }
        back={{ href: "/submissions", label: "Register" }}
      />
      {filingType && reg && !registered && (
        <p
          role="alert"
          className="mb-4 max-w-3xl rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          No Registered record has registration number {reg}. Check the number, or enter the
          filing’s details by hand.
        </p>
      )}
      <p className="mb-4 max-w-3xl text-sm text-gray-600">
        {registered
          ? `The form starts as a copy of ${registered.registrationNo}. Change only what the filing changes; once approved, the differences are applied to the registered record and recorded in its audit log.`
          : "Saving assigns the acknowledgement number and fixes the category, fees and deadline under the current fee table and Settings. Own-use generation (200 kW to below 1 MW) is filed on Form REG-01I under Own-use."}
      </p>
      <SubmissionForm
        mode="create"
        action={createSubmissionAction}
        options={options}
        initial={initial}
      />
    </div>
  );
}
