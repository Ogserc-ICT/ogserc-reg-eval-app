import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { lagosTimestamp } from "@/server/audit-log";
import { listUploads } from "@/server/workbook-import";
import { uploadWorkbookAction } from "../actions";
import { UploadForm } from "./upload-form";

// Serverless hosts (Vercel) stop functions after a time limit. Reading an uploaded workbook (server action on this page) can take several seconds.
export const maxDuration = 300;

export default async function ImportPage() {
  await requirePermission("register.import");
  const uploads = await listUploads(db);

  return (
    <div className="max-w-4xl">
      <PageHeader title="Import from the workbook" back={{ href: "/admin", label: "Admin" }} />
      <div className="mb-6 space-y-2 text-sm text-gray-700">
        <p>
          Upload the Excel workbook (<em>OGSERC_Registration_and_Evaluation_System.xlsm</em>). You
          will see everything that would be imported, and every problem, before anything is saved.
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            Register rows (with their document checklist and evaluation), own-use notifications,
            payments and the workbook&apos;s audit log are imported. Example rows are skipped.
          </li>
          <li>
            Acknowledgement, payment, own-use and registration numbers are kept. Issued registration
            numbers are locked.
          </li>
          <li>
            Fees and late charges are worked out with the app&apos;s fee table and Settings; any
            difference from the workbook&apos;s figures is listed.
          </li>
          <li>
            Nothing is imported while any error remains. Rows already imported are skipped, so a
            corrected workbook can be imported again.
          </li>
        </ul>
      </div>

      <UploadForm action={uploadWorkbookAction} />

      <h2 className="text-brand-800 mt-8 mb-2 text-lg font-semibold">Uploads</h2>
      {uploads.length ? (
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Uploaded</th>
                <th className="px-3 py-2 font-medium">Imported</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {uploads.map((u) => (
                <tr key={u.id} className="align-top">
                  <td className="px-3 py-2">
                    <Link href={`/admin/import/${u.id}`} className="text-brand-700 hover:underline">
                      {u.fileName}
                    </Link>
                    <span className="block text-xs text-gray-500">
                      {Math.round(u.size / 1024).toLocaleString("en-NG")} KB · SHA-256{" "}
                      {u.sha256.slice(0, 12)}…
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {lagosTimestamp(u.uploadedAt)}
                    <span className="block text-xs text-gray-500">{u.uploadedBy.name}</span>
                  </td>
                  <td className="px-3 py-2">
                    {u.importedAt ? (
                      <>
                        {lagosTimestamp(u.importedAt)} by {u.importedBy?.name}
                        <span className="block text-xs text-gray-500">{u.summary}</span>
                      </>
                    ) : (
                      <span className="text-gray-500">Not imported</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-gray-500">No workbook uploaded yet.</p>
      )}
    </div>
  );
}
