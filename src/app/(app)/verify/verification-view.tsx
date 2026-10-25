import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { formatDate } from "@/domain/dates";
import { lagosTimestamp } from "@/server/audit-log";
import type { Verification, Verdict } from "@/server/verify";

const VERDICT: Record<Verdict, { icon: string; title: string; text: string; tone: string }> = {
  current: {
    icon: "✓",
    title: "Registered",
    text: "This registration is current.",
    tone: "border-green-300 bg-green-50 text-green-900",
  },
  provisional: {
    icon: "!",
    title: "Provisionally registered",
    text: "Registered by operation of para 13(4); no certificate has been issued yet.",
    tone: "border-amber-300 bg-amber-50 text-amber-900",
  },
  "not-valid": {
    icon: "✕",
    title: "Not valid",
    text: "This registration is not in force. A certificate for it must not be relied on.",
    tone: "border-red-300 bg-red-50 text-red-900",
  },
  "not-registered": {
    icon: "✕",
    title: "Not registered",
    text: "This submission has not been registered. A certificate for it is not genuine.",
    tone: "border-red-300 bg-red-50 text-red-900",
  },
};

/** What a certificate's QR code shows: the registration as held now, and every certificate issued. */
export function VerificationView({
  v,
  open,
}: {
  v: Verification;
  open: { href: string; label: string };
}) {
  const verdict = VERDICT[v.verdict];
  const latest = v.certificates.find((c) => !c.supersededAt);

  const rows: [string, string | null][] = [
    ["Registration No.", v.registrationNo],
    ["Registered name", v.name],
    ["CAC / Registration No.", v.cacNo],
    ["Category", v.category],
    ["Primary activity", v.primaryActivity],
    ["Principal LGA and service area", v.area],
    ["Certificate issue date", v.certificateIssueDate ? formatDate(v.certificateIssueDate) : null],
    ["Status", v.status],
  ];

  return (
    <div className="max-w-3xl">
      <PageHeader title="Certificate verification" />
      <div
        role="status"
        className={`mb-4 flex items-start gap-3 rounded border px-4 py-3 ${verdict.tone}`}
      >
        <span aria-hidden className="text-2xl leading-none font-bold">
          {verdict.icon}
        </span>
        <div>
          <p className="text-lg font-semibold">{verdict.title}</p>
          <p className="text-sm">{verdict.text}</p>
        </div>
      </div>
      <p className="mb-3 text-sm text-gray-700">
        Check that the name and registration number printed on the certificate match the ones below
        exactly.
      </p>

      <dl className="divide-y divide-gray-100 rounded border border-gray-200 bg-white text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-3 gap-3 px-3 py-2">
            <dt className="text-gray-600">{label}</dt>
            <dd className="col-span-2 font-medium">{value || "—"}</dd>
          </div>
        ))}
      </dl>

      <h2 className="text-brand-800 mt-6 mb-2 text-lg font-semibold">Certificates issued</h2>
      {v.certificates.length ? (
        <ul className="space-y-1 text-sm">
          {v.certificates.map((c) => (
            <li key={c.id}>
              Version {c.version}, {lagosTimestamp(c.createdAt)}
              {c.supersededAt ? (
                <span className="text-red-800"> — replaced {lagosTimestamp(c.supersededAt)}</span>
              ) : (
                <span className="text-green-800"> — current</span>
              )}
              {c.note && <span className="text-gray-600"> · {c.note}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-600">No certificate has been issued in this system.</p>
      )}
      {latest && v.certificates.length > 1 && (
        <p className="mt-2 text-sm text-gray-700">
          A certificate marked &ldquo;Reissued&rdquo; under its serial number is a later version;
          only the current version should be relied on.
        </p>
      )}
      {v.certificateNeedsReissue && (
        <p className="mt-2 text-sm text-amber-900">
          Details printed on the certificate have changed since it was issued; a reissue is due.
        </p>
      )}
      <p className="mt-6 text-sm">
        <Link href={open.href} className="text-brand-700 hover:underline">
          {open.label} →
        </Link>
      </p>
    </div>
  );
}
