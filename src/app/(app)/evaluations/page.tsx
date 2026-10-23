import Link from "next/link";
import { SlaBadge, StatusBadge } from "@/components/badges";
import { inputClass } from "@/components/form";
import { PageHeader } from "@/components/page-header";
import { evaluationProgress } from "@/domain/evaluation";
import { STATUS, isClosed } from "@/domain/types";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { loadContext } from "@/server/context";
import { loadEvaluationStates } from "@/server/evaluation-state";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const EVALUATION_STATUSES = ["Not assigned", "In progress", "Ready for decision", "Decided"];

export default async function EvaluationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("records.read");
  const sp = await searchParams;
  const mine = one(sp.mine) === "1";
  const includeClosed = one(sp.closed) === "1";
  const status = one(sp.status);

  const states = await loadEvaluationStates(db, await loadContext(db));
  const rows = states.filter((s) => {
    const ev = s.evaluation;
    if (!includeClosed && isClosed(s.sub.status)) return false;
    // Awaiting payment: not in evaluation until Finance confirms (§4.12); see the dashboard queue.
    if (s.sub.status === STATUS.AWAITING) return false;
    if (status && s.status !== status) return false;
    if (
      mine &&
      ![ev.evaluatingOfficerId, ev.reviewingSupervisorId, ev.approvingOfficerId].includes(user.id)
    ) {
      return false;
    }
    return true;
  });

  return (
    <div>
      <PageHeader title="Evaluations" />
      <p className="mb-3 text-sm text-gray-600">
        Submissions still awaiting Finance confirmation of payment are not listed here; see the
        dashboard queue &ldquo;Awaiting payment&rdquo;.
      </p>
      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-4 rounded border border-gray-200 bg-white p-3"
      >
        <label className="text-xs text-gray-600">
          Evaluation status
          <select name="status" defaultValue={status} className={`${inputClass} mt-0.5`}>
            <option value="">All</option>
            {EVALUATION_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="mine" value="1" defaultChecked={mine} />
          Assigned to me
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="closed" value="1" defaultChecked={includeClosed} />
          Include closed
        </label>
        <button
          type="submit"
          className="bg-brand-700 hover:bg-brand-800 rounded px-3 py-1.5 text-sm text-white"
        >
          Apply
        </button>
      </form>

      {rows.length ? (
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-50 text-brand-900 text-xs">
              <tr>
                <th className="px-2 py-2">Ack No.</th>
                <th className="px-2 py-2">Registered name</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Evaluation</th>
                <th className="px-2 py-2">Progress</th>
                <th className="px-2 py-2">Recommended</th>
                <th className="px-2 py-2">Evaluator</th>
                <th className="px-2 py-2">Approver</th>
                <th className="px-2 py-2">SLA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((s) => (
                <tr key={s.row.id} className="hover:bg-gray-50">
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <Link
                      href={`/submissions/${s.row.id}/evaluation`}
                      className="text-brand-700 font-medium hover:underline"
                    >
                      {s.row.ackNo}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">{s.row.registeredName}</td>
                  <td className="px-2 py-1.5">
                    <StatusBadge status={s.sub.status!} />
                  </td>
                  <td className="px-2 py-1.5">{s.status}</td>
                  <td className="px-2 py-1.5">{Math.round(evaluationProgress(s.counts) * 100)}%</td>
                  <td className="px-2 py-1.5 text-xs">{s.recommended}</td>
                  <td className="px-2 py-1.5">{s.evaluationRow.evaluatingOfficer?.name ?? "—"}</td>
                  <td className="px-2 py-1.5">{s.evaluationRow.approvingOfficer?.name ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    <SlaBadge sla={s.assessment.sla} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded border border-gray-200 bg-white p-6 text-sm text-gray-600">
          No evaluations match.
        </p>
      )}
    </div>
  );
}
