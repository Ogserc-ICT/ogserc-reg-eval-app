"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { ConfirmBox } from "@/components/confirm-box";
import { Field, FormMessage, SubmitButton, formKey, inputClass } from "@/components/form";
import { MultiCheckField, RowsField } from "@/components/rows-field";
import { TechnicalSections } from "@/components/technical-sections";
import { categoryForActivity } from "@/domain/category";
import { CONDITION_KEYS, CONDITION_LABELS, formCodeFor } from "@/domain/forms";
import { conditionsDecidedBy, type TechnicalData } from "@/domain/technical";
import { FILING_LABELS, type FilingType } from "@/domain/types";
import type { ActionState } from "@/lib/action";
import { CONDITION_FIELDS as CONDITION_FIELD } from "@/lib/schemas";
import type { FormOptions } from "@/server/options";

export type SubmissionFormValues = Record<string, string>;

type Choice = { value: string; label: string };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded border border-gray-200 bg-white p-4">
      <legend className="text-brand-800 px-1 text-sm font-semibold">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

/** Optional sections stay folded so intake is as quick as before; open when they hold data. */
function More({
  title,
  open,
  children,
}: {
  title: string;
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className="rounded border border-gray-200 bg-white">
      <summary className="text-brand-800 cursor-pointer px-4 py-2.5 text-sm font-semibold">
        {title} <span className="font-normal text-gray-500">(optional)</span>
      </summary>
      <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </details>
  );
}

const hasRows = (json: string | undefined) => !!json && json !== "[]";

function parseJson<T>(json: string | undefined, fallback: T): T {
  try {
    return json ? (JSON.parse(json) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function SubmissionForm({
  mode,
  action,
  initial,
  options,
  closedStatus,
}: {
  mode: "create" | "edit";
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  initial: SubmissionFormValues;
  options: FormOptions;
  /** Set when editing a closed submission: Admin only, and a reason is required. */
  closedStatus?: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, {});
  const e = state.fieldErrors;
  const v = (state.values as SubmissionFormValues | undefined) ?? initial;
  const [filingType, setFilingType] = useState<FilingType>((v.filingType as FilingType) || "NEW");
  const [formFiled, setFormFiled] = useState(v.formFiled ?? "");
  const [regNo, setRegNo] = useState(v.linkedRegistrationNo ?? "");
  const linked = filingType !== "NEW";
  const [technical, setTechnical] = useState<TechnicalData>(() =>
    parseJson<TechnicalData>(v.technicalData, {}),
  );
  const [otherCodes, setOtherCodes] = useState<string[]>(() =>
    parseJson<string[]>(v.otherActivityCodes, []),
  );
  const [capacity, setCapacity] = useState(v.installedCapacityMw ?? "");

  // The form filed's sections, then each other activity's form at this capacity (para 17(1)).
  const capacityMw = Number(String(capacity).replace(/,/g, "")) || 0;
  const otherForms = otherCodes
    .map((code) => options.activities.find((a) => a.code === code))
    .map((a) =>
      a
        ? categoryForActivity(a, capacityMw, {
            supplyRetailCategory1MwPlus: options.supplyRetailCategory1MwPlus,
          })
        : null,
    )
    .filter((c): c is string => !!c && c !== "I")
    .map(formCodeFor);
  const technicalForms = [...new Set([formFiled, ...otherForms])].filter(
    (f) => !!f && !!options.technical[f],
  );
  const formTitles = Object.fromEntries(options.forms.map((f) => [f.form, f.title]));
  // The licence status and the sections' answers decide these; their yes/no question is not asked.
  const decided = new Set([
    "holds_any_licence",
    ...conditionsDecidedBy(options.technical, technicalForms),
  ]);

  const text = (
    name: string,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
    hint?: string,
  ) => (
    <Field label={label} name={name} errors={e} hint={hint}>
      <input
        id={name}
        name={name}
        defaultValue={v[name] ?? ""}
        className={inputClass}
        aria-invalid={!!e?.[name]}
        {...props}
      />
    </Field>
  );
  const select = (
    name: string,
    label: string,
    choices: Choice[],
    required = false,
    hint?: string,
    onChange?: (value: string) => void,
  ) => (
    <Field label={label} name={name} errors={e} hint={hint}>
      <select
        id={name}
        name={name}
        defaultValue={v[name] ?? ""}
        className={inputClass}
        aria-invalid={!!e?.[name]}
        onChange={onChange ? (ev) => onChange(ev.target.value) : undefined}
      >
        <option value="">{required ? "Choose…" : "(none)"}</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </Field>
  );
  const list = (items: string[]): Choice[] => items.map((s) => ({ value: s, label: s }));
  const activities = options.activities.map((a) => ({
    value: a.code,
    label: `${a.name} (${a.code})`,
  }));
  const yesNo = [
    { value: "Y", label: "Yes" },
    { value: "N", label: "No" },
  ];

  // Conditions used by the selected form's documents (all of them when other activities' forms
  // also apply). The others are kept as they are but not shown.
  const selectedForm = options.forms.find((f) => f.form === formFiled);
  const shownConditions = (
    options.otherActivitiesRequireDocuments ? [...CONDITION_KEYS] : (selectedForm?.conditions ?? [])
  ).filter((k) => !decided.has(k));
  const hiddenConditions = CONDITION_KEYS.filter((k) => !shownConditions.includes(k));

  const ownershipFilled =
    hasRows(v.shareholders) || hasRows(v.directors) || !!(v.mdName || v.mdPhone || v.mdEmail);
  const identityFilled = !!(
    v.tradingName ||
    v.incorporationDate ||
    v.operationalAddress ||
    v.website
  );
  const declarationFilled = !!(v.signatory1Name || v.signatory2Name);

  return (
    <form key={formKey(state)} action={formAction} className="max-w-5xl space-y-5" noValidate>
      <FormMessage state={state} />
      <ConfirmBox state={state} />

      <Section title="Filing">
        {mode === "create" ? (
          select(
            "filingType",
            "Filing type *",
            (Object.keys(FILING_LABELS) as FilingType[]).map((t) => ({
              value: t,
              label: FILING_LABELS[t],
            })),
            true,
            undefined,
            (value) => setFilingType((value as FilingType) || "NEW"),
          )
        ) : (
          <div>
            <p className="mb-1 text-sm font-medium text-gray-800">Filing type</p>
            <p className="py-1.5 text-sm">{FILING_LABELS[filingType]}</p>
            <input type="hidden" name="filingType" value={filingType} />
          </div>
        )}
        {select(
          "formFiled",
          "Form filed *",
          options.forms.map((f) => ({ value: f.form, label: `${f.form} — ${f.title}` })),
          true,
          "The category is still worked out from the activities; the evaluator confirms it",
          setFormFiled,
        )}
        {linked &&
          (mode === "create" ? (
            <div>
              <Field
                label="OGSERC registration no. *"
                name="linkedRegistrationNo"
                errors={e}
                hint="The registered record this filing updates or confirms"
              >
                <input
                  id="linkedRegistrationNo"
                  name="linkedRegistrationNo"
                  value={regNo}
                  onChange={(ev) => setRegNo(ev.target.value)}
                  className={inputClass}
                  placeholder="OGSERC/REG/2026/E-MGD/0001"
                  aria-invalid={!!e?.linkedRegistrationNo}
                />
              </Field>
              <button
                type="button"
                disabled={!regNo.trim()}
                onClick={() =>
                  router.push(
                    `/submissions/new?filing=${filingType}&reg=${encodeURIComponent(regNo.trim())}`,
                  )
                }
                className="border-brand-600 text-brand-800 hover:bg-brand-50 mt-1.5 rounded border px-2.5 py-1 text-xs font-medium disabled:opacity-50"
              >
                Copy the registered record’s details
              </button>
            </div>
          ) : (
            <div>
              <p className="mb-1 text-sm font-medium text-gray-800">Registration</p>
              <p className="py-1.5 text-sm">{v.linkedRegistrationNo}</p>
              <input
                type="hidden"
                name="linkedRegistrationNo"
                value={v.linkedRegistrationNo ?? ""}
              />
            </div>
          ))}
      </Section>

      <Section title="A. Applicant">
        {text("registeredName", "Registered name *")}
        {text("dateSubmitted", "Date submitted *", { type: "date" })}
        {select("submissionChannel", "Submission channel", list(options.channels))}
        {select("registrantType", "Registrant type", list(options.registrantTypes))}
        {text(
          "cacNo",
          "CAC number",
          { placeholder: "RC123456" },
          "RC, BN or IT followed by digits",
        )}
        {text("tin", "TIN")}
        <div className="sm:col-span-2 lg:col-span-3">{text("address", "Registered address")}</div>
      </Section>

      <More title="A. Applicant — more details" open={identityFilled}>
        {text("tradingName", "Trading name")}
        {text("incorporationDate", "Date of incorporation", { type: "date" })}
        {text("website", "Website", { type: "url", placeholder: "https://" })}
        <div className="sm:col-span-2 lg:col-span-3">
          {text("operationalAddress", "Operational address in Ogun State")}
        </div>
      </More>

      <Section title="B. Management and contact">
        {text("complianceOfficer", "Regulatory compliance officer")}
        {text("phone", "Compliance officer phone", { type: "tel", placeholder: "080…" })}
        {text("email", "Compliance officer email", { type: "email" })}
      </Section>

      <More title="B. Ownership and management" open={ownershipFilled}>
        {text("mdName", "Managing director / principal officer")}
        {text("mdPhone", "MD phone", { type: "tel", placeholder: "080…" })}
        {text("mdEmail", "MD email", { type: "email" })}
        <RowsField
          name="shareholders"
          label="Shareholders or members holding 5% or more"
          initial={v.shareholders}
          errors={e}
          addLabel="Add shareholder"
          columns={[
            { key: "name", label: "Name", span: 3 },
            { key: "nationality", label: "Nationality / country", span: 2 },
            { key: "percentHolding", label: "% holding", type: "number" },
            {
              key: "beneficialOwner",
              label: "Beneficial owner?",
              type: "select",
              options: yesNo,
            },
          ]}
        />
        <RowsField
          name="directors"
          label="Directors and key officers"
          initial={v.directors}
          errors={e}
          addLabel="Add director or officer"
          columns={[
            { key: "name", label: "Name", span: 3 },
            { key: "position", label: "Position", span: 2 },
            { key: "phone", label: "Phone", type: "tel", span: 2 },
            { key: "email", label: "Email", type: "email", span: 2 },
          ]}
        />
      </More>

      <Section title="C. Licences, permits and registrations">
        {select("licenceStatus", "Licence status *", list(options.licenceStatuses), true)}
        <RowsField
          name="licences"
          label="Licences held"
          initial={v.licences}
          errors={e}
          addLabel="Add licence"
          hint="One row per licence, permit or registration. Renewal checks use the nearest expiry date."
          columns={[
            { key: "type", label: "Type", span: 2 },
            { key: "issuingAuthority", label: "Issuing authority", span: 2 },
            { key: "number", label: "Number", span: 2 },
            { key: "issueDate", label: "Issued", type: "date", span: 2 },
            { key: "expiryDate", label: "Expires", type: "date", span: 2 },
            { key: "activityCovered", label: "Activity / site", span: 2 },
          ]}
        />
      </Section>

      <Section title="D. Service area">
        {select("principalLga", "Principal LGA *", list(options.lgas), true)}
        <div className="lg:col-span-2">
          {text("otherAreasServed", "Towns, communities, estates or industrial clusters served")}
        </div>
        <MultiCheckField
          name="lgasServed"
          label="LGAs served"
          options={list(options.lgas)}
          initial={v.lgasServed}
          errors={e}
          hint="The principal LGA counts as served whether or not it is ticked."
        />
      </Section>

      <Section title="Activities and assets">
        {select("primaryActivityCode", "Primary activity *", activities, true)}
        {text(
          "installedCapacityMw",
          "Installed capacity (MW)",
          { inputMode: "decimal", onChange: (ev) => setCapacity(ev.target.value) },
          "Sets the category for generation, captive, mini-grid and other activities",
        )}
        {text("customers", "Customers", { inputMode: "numeric" })}
        <MultiCheckField
          name="otherActivityCodes"
          label="Other activities in Ogun State"
          options={activities}
          initial={v.otherActivityCodes}
          errors={e}
          hint="Tick every other activity. The fee is for the highest category of all of them (para 17(1)); each activity's form sections appear below."
          onChange={setOtherCodes}
        />
      </Section>

      <input type="hidden" name="technicalData" value={JSON.stringify(technical)} />
      {technicalForms.length > 0 && (
        <TechnicalSections
          defs={options.technical}
          forms={technicalForms}
          titles={formTitles}
          value={technical}
          onChange={setTechnical}
          errors={e?.technicalData}
        />
      )}

      {shownConditions.length > 0 && (
        <Section title="Documents that depend on the answers">
          {shownConditions.map((k) =>
            select(
              CONDITION_FIELD[k],
              CONDITION_LABELS[k],
              yesNo,
              false,
              "No makes its documents N/A",
            ),
          )}
        </Section>
      )}
      {hiddenConditions.map((k) => (
        <input
          key={k}
          type="hidden"
          name={CONDITION_FIELD[k]}
          value={v[CONDITION_FIELD[k]] ?? ""}
        />
      ))}

      <More
        title="Health, safety and environment; confidentiality claims"
        open={hasRows(v.hseIncidents) || hasRows(v.confidentialityClaims)}
      >
        <RowsField
          name="hseIncidents"
          label="Incidents in the last 24 months"
          initial={v.hseIncidents}
          errors={e}
          addLabel="Add incident"
          columns={[
            { key: "date", label: "Date", type: "date", span: 2 },
            { key: "location", label: "Location", span: 2 },
            {
              key: "type",
              label: "Type",
              type: "select",
              options: list(options.hseTypes),
              span: 2,
            },
            { key: "description", label: "Description and action", span: 4 },
          ]}
        />
        <RowsField
          name="confidentialityClaims"
          label="Items claimed as commercially sensitive (para 15(3))"
          initial={v.confidentialityClaims}
          errors={e}
          addLabel="Add claim"
          columns={[
            { key: "item", label: "Item", span: 2 },
            { key: "reasons", label: "Reasons", span: 3 },
          ]}
        />
      </More>

      <More title="Declaration: two signatories" open={declarationFilled}>
        {text("signatory1Name", "Signatory 1: name")}
        {text("signatory1Designation", "Designation", {}, "e.g. Director")}
        {text("signatory1Date", "Date signed", { type: "date" })}
        {text("signatory2Name", "Signatory 2: name")}
        {text("signatory2Designation", "Designation", {}, "e.g. Company Secretary")}
        {text("signatory2Date", "Date signed", { type: "date" })}
      </More>

      <Section title="Timeline (para 11)">
        {select(
          "operatingOnEffectiveDate",
          "Operating on the Effective Date? *",
          [
            { value: "Y", label: "Yes – existing operator" },
            { value: "N", label: "No – new operator" },
          ],
          true,
        )}
        {text(
          "plannedStartDate",
          "Planned start date",
          { type: "date" },
          "Required for a new operator",
        )}
      </Section>

      <Section title="Category (Schedule 3)">
        {select(
          "categoryOverride",
          "Category override",
          options.categories.map((c) => ({
            value: c.category,
            label: `${c.category} – ${c.description}`,
          })),
          false,
          "Leave as (none) to use the category worked out from the activities and capacity",
        )}
        <div className="lg:col-span-2">{text("overrideReason", "Reason for override")}</div>
      </Section>

      {mode === "create" && (
        <Section title="Evaluation">
          {select(
            "evaluatingOfficerId",
            "Evaluating officer",
            options.evaluators.map((u) => ({ value: u.id, label: u.name })),
            false,
            "Optional. Evaluation starts once Finance has confirmed payment.",
          )}
        </Section>
      )}

      <Field label="Remarks" name="remarks" errors={e}>
        <textarea
          id="remarks"
          name="remarks"
          rows={3}
          defaultValue={v.remarks ?? ""}
          className={inputClass}
        />
      </Field>

      {closedStatus && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3">
          <Field
            label={`Reason for changing a ${closedStatus} submission *`}
            name="changeReason"
            errors={e}
            hint="Recorded in the audit log with the old and new values."
          >
            <input
              id="changeReason"
              name="changeReason"
              defaultValue={v.changeReason ?? ""}
              className={inputClass}
            />
          </Field>
        </div>
      )}

      <SubmitButton>{mode === "create" ? "Save submission" : "Save changes"}</SubmitButton>
    </form>
  );
}
