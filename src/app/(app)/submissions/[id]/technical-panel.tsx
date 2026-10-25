import { Panel } from "@/components/panel";
import {
  NO_ANSWERS,
  fieldText,
  type FormProgress,
  type SectionStatus,
  type TechnicalData,
  type TechnicalDefs,
} from "@/domain/technical";

const STATUS: Record<SectionStatus, { text: string; tone: string }> = {
  complete: { text: "Complete", tone: "bg-brand-100 text-brand-900" },
  incomplete: { text: "Incomplete", tone: "bg-amber-100 text-amber-900" },
  empty: { text: "Not filled in", tone: "bg-gray-200 text-gray-700" },
  "not-applicable": { text: "Does not apply", tone: "bg-gray-100 text-gray-600" },
  "not-required": { text: "Not required", tone: "bg-gray-100 text-gray-600" },
};

/** The category-specific sections of each form the submission answers, read-only. */
export function TechnicalPanel({
  defs,
  data,
  progress,
}: {
  defs: TechnicalDefs;
  data: TechnicalData;
  progress: FormProgress[];
}) {
  if (!progress.length) return null;
  return (
    <Panel title="Category-specific sections">
      <div className="space-y-4">
        {progress.map((p, i) => {
          const answers = data[p.form] ?? NO_ANSWERS;
          return (
            <section key={p.form} aria-label={`${p.form} sections`}>
              <h3 className="text-brand-900 mb-1 text-sm font-semibold">
                {p.form} {i === 0 ? "(form filed)" : "(other activity)"}
              </h3>
              <ul className="space-y-2 text-sm">
                {defs[p.form]!.sections.map((s) => {
                  const status = p.sections.find((x) => x.key === s.key)!.status;
                  const values = answers.sections[s.key] ?? {};
                  const lines = s.fields
                    .map((f) => [f.label, fieldText(f, values[f.key])] as const)
                    .filter(([, t]) => t);
                  return (
                    <li key={s.key}>
                      <span className="font-medium">{s.title}</span>{" "}
                      <span
                        className={`ml-1 rounded px-1.5 py-0.5 text-xs font-medium ${STATUS[status].tone}`}
                      >
                        {STATUS[status].text}
                      </span>
                      {lines.length > 0 && status !== "not-applicable" && (
                        <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-[14rem_1fr]">
                          {lines.map(([label, t]) => (
                            <div key={label} className="contents">
                              <dt className="text-gray-500">{label}</dt>
                              <dd className="break-words">{t}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </Panel>
  );
}
