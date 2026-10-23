import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import type { ImportProblem } from "@/domain/workbook-import";
import { formatNaira } from "@/domain/money";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { lagosTimestamp } from "@/server/audit-log";
import { NotFoundError } from "@/server/errors";
import { previewImport } from "@/server/workbook-import";
import { commitImportAction } from "../../actions";
import { CommitForm } from "./commit-form";

// Serverless hosts (Vercel) stop functions after a time limit. The preview and the import (server action) process the whole workbook in one go.
export const maxDuration = 300;

function Problems({ title, items }: { title: string; items: ImportProblem[] }) {
  if (!items.length) return null;
  return (
    <section aria-label={title} className="mt-6">
      <h2 className="text-brand-800 mb-2 text-lg font-semibold">
        {title} ({items.length})
      </h2>
      <div className="max-h-96 overflow-auto rounded border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-600">
            <tr>
              <th className="px-3 py-2 font-medium">Sheet</th>
              <th className="px-3 py-2 font-medium">Row</th>
              <th className="px-3 py-2 font-medium">Reference</th>
              <th className="px-3 py-2 font-medium">Problem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((p, i) => (
              <tr key={i} className="align-top">
                <td className="px-3 py-1.5 whitespace-nowrap">{p.sheet}</td>
                <td className="px-3 py-1.5 tabular-nums">{p.row ?? ""}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{p.reference}</td>
                <td className="px-3 py-1.5">{p.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function ImportPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("register.import");
  const { id } = await params;
  let preview;
  try {
    preview = await previewImport(db, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { upload, plan, summary } = preview;
  const of = (level: ImportProblem["level"]) => plan.problems.filter((p) => p.level === level);
  const nothingNew = !summary.submissions && !summary.ownUse && !summary.payments;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={upload.fileName}
        back={{ href: "/admin/import", label: "Import from the workbook" }}
      />
      <p className="mb-4 text-sm text-gray-600">
        Uploaded {lagosTimestamp(upload.uploadedAt)} by {upload.uploadedBy.name} · SHA-256{" "}
        {upload.sha256.slice(0, 16)}…
      </p>

      {upload.importedAt ? (
        <p
          role="status"
          className="border-brand-100 bg-brand-50 text-brand-900 mb-4 rounded border px-3 py-2 text-sm"
        >
          Imported {lagosTimestamp(upload.importedAt)} by {upload.importedBy?.name}:{" "}
          {upload.summary}. The preview below is against the data as it is now.
        </p>
      ) : null}

      <section aria-label="Summary" className="grid gap-3 sm:grid-cols-4">
        {[
          ["Submissions", summary.submissions],
          ["Own-use notifications", summary.ownUse],
          ["Payments", summary.payments],
          ["Workbook audit entries", summary.audit],
        ].map(([label, n]) => (
          <div key={label} className="rounded border border-gray-200 bg-white px-3 py-2">
            <span className="block text-xs text-gray-600">{label}</span>
            <span className="text-xl font-semibold tabular-nums">{n}</span>
          </div>
        ))}
      </section>
      <p className="mt-3 text-sm text-gray-700">
        <strong>{summary.errors}</strong> error{summary.errors === 1 ? "" : "s"} ·{" "}
        {summary.warnings} warning{summary.warnings === 1 ? "" : "s"} · {summary.pricingDifferences}{" "}
        pricing difference
        {summary.pricingDifferences === 1 ? "" : "s"} · {summary.skipped} row
        {summary.skipped === 1 ? "" : "s"} skipped
      </p>

      {!upload.importedAt && (
        <div className="mt-4">
          {summary.errors ? (
            <p
              role="alert"
              className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              Fix the errors below in the workbook, then upload it again. Nothing is imported while
              any error remains.
            </p>
          ) : nothingNew ? (
            <p className="text-sm text-gray-600">
              There is nothing new to import in this workbook.
            </p>
          ) : (
            <CommitForm
              action={commitImportAction.bind(null, id)}
              label={`Import ${summary.submissions} submissions, ${summary.ownUse} own-use notifications and ${summary.payments} payments`}
            />
          )}
        </div>
      )}

      <Problems title="Errors" items={of("error")} />
      <Problems title="Warnings" items={of("warning")} />

      {plan.pricingDifferences.length > 0 && (
        <section aria-label="Pricing differences" className="mt-6">
          <h2 className="text-brand-800 mb-1 text-lg font-semibold">
            Pricing differences ({plan.pricingDifferences.length})
          </h2>
          <p className="mb-2 text-sm text-gray-600">
            The app&apos;s figures (current fee table and Settings) are the ones imported.
          </p>
          <div className="max-h-96 overflow-auto rounded border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Submission</th>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Workbook</th>
                  <th className="px-3 py-2 text-right font-medium">App</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plan.pricingDifferences.map((d, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5">
                      {d.name}
                      <span className="block text-xs text-gray-500">{d.ackNo}</span>
                    </td>
                    <td className="px-3 py-1.5">{d.item}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatNaira(d.workbook)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatNaira(d.app)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Problems title="Skipped" items={of("skipped")} />

      {plan.submissions.length > 0 && (
        <section aria-label="Submissions to import" className="mt-6">
          <h2 className="text-brand-800 mb-2 text-lg font-semibold">
            Submissions to import ({plan.submissions.length})
          </h2>
          <div className="max-h-96 overflow-auto rounded border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Ack No.</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Registration No.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plan.submissions.map((s) => (
                  <tr key={s.ackNo}>
                    <td className="px-3 py-1.5 whitespace-nowrap">{s.ackNo}</td>
                    <td className="px-3 py-1.5">{s.data.registeredName}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{s.data.status}</td>
                    <td className="px-3 py-1.5">{s.pricing.category}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{s.data.registrationNo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
