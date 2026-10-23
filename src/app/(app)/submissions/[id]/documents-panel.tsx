import type { DocumentKind } from "@prisma/client";
import { Panel } from "@/components/panel";
import { can, type Role } from "@/domain/roles";
import { DOCUMENT_LABELS } from "@/server/documents";
import {
  generateAcknowledgementAction,
  generateEvaluationFormAction,
  reissueCertificateAction,
} from "../actions";
import { GenerateButton, ReissueCertificateForm } from "./document-buttons";

export interface IssuedDocument {
  id: string;
  kind: DocumentKind;
  version: number;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  note: string | null;
  createdAt: Date;
  supersededAt: Date | null;
  generatedBy: { name: string };
}

const when = (d: Date) =>
  d.toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });

/** Every PDF issued for this submission, with what the user's roles let them generate. */
export function DocumentsPanel({
  submissionId,
  documents,
  roles,
  registered,
  open,
  needsReissue,
}: {
  submissionId: string;
  documents: IssuedDocument[];
  roles: Role[];
  registered: boolean;
  open: boolean;
  needsReissue: boolean;
}) {
  const hasCertificate = documents.some((d) => d.kind === "CERTIFICATE");
  return (
    <Panel title="Issued documents">
      {documents.length ? (
        <table className="mb-4 w-full text-left text-sm">
          <thead className="text-xs text-gray-500">
            <tr>
              <th className="py-1 pr-2 font-normal">Document</th>
              <th className="py-1 pr-2 font-normal">Generated</th>
              <th className="py-1 pr-2 font-normal">SHA-256</th>
              <th className="py-1 font-normal">File</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {documents.map((d) => (
              <tr key={d.id} className={`align-top ${d.supersededAt ? "text-gray-400" : ""}`}>
                <td className="py-1.5 pr-2">
                  {DOCUMENT_LABELS[d.kind]} v{d.version}
                  {d.supersededAt && <span className="ml-1 text-xs">(superseded)</span>}
                  {d.note && <span className="block text-xs text-gray-500">{d.note}</span>}
                </td>
                <td className="py-1.5 pr-2 whitespace-nowrap">
                  {when(d.createdAt)}
                  <span className="block text-xs text-gray-500">{d.generatedBy.name}</span>
                </td>
                <td className="py-1.5 pr-2 font-mono text-xs" title={d.sha256}>
                  {d.sha256.slice(0, 12)}…
                </td>
                <td className="py-1.5 whitespace-nowrap">
                  <a
                    href={`/documents/${d.id}`}
                    target="_blank"
                    className="text-brand-700 hover:underline"
                  >
                    Open
                  </a>
                  {" · "}
                  <a
                    href={`/documents/${d.id}?download=1`}
                    className="text-brand-700 hover:underline"
                  >
                    Download
                  </a>
                  <span className="ml-1 text-xs text-gray-500">
                    ({Math.ceil(d.sizeBytes / 1024)} KB)
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mb-4 text-sm text-gray-500">No documents issued yet.</p>
      )}

      <div className="flex flex-wrap items-start gap-3">
        {can(roles, "letter.acknowledgement") && (
          <GenerateButton
            action={generateAcknowledgementAction.bind(null, submissionId)}
            label="Generate acknowledgement letter"
          />
        )}
        {can(roles, "records.read") && (
          <GenerateButton
            action={generateEvaluationFormAction.bind(null, submissionId)}
            label="Print evaluation form (EVAL-01)"
          />
        )}
        {open && (can(roles, "deficiency.draft") || can(roles, "deficiency.issue")) && (
          <a
            href={`/submissions/${submissionId}/deficiency-draft`}
            target="_blank"
            className="border-brand-700 text-brand-700 hover:bg-brand-50 rounded border px-3 py-2 text-sm"
          >
            Preview draft deficiency notice
          </a>
        )}
      </div>

      {registered && can(roles, "certificate.reissue") && (needsReissue || !hasCertificate) && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <h3 className="text-brand-900 mb-2 text-sm font-semibold">
            {hasCertificate ? "Reissue certificate" : "Issue certificate"}
          </h3>
          <ReissueCertificateForm
            action={reissueCertificateAction.bind(null, submissionId)}
            label={hasCertificate ? "Reissue certificate" : "Issue certificate"}
          />
        </div>
      )}
    </Panel>
  );
}
