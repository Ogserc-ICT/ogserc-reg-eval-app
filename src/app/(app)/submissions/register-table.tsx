"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { PaymentBadge, SlaBadge, StatusBadge } from "@/components/badges";
import { Field, FormMessage, SubmitButton, inputClass } from "@/components/form";
import { showDate, showMoney } from "@/lib/format";
import type { RegisterRow } from "@/server/register";
import { bulkRecalculateAction } from "./actions";

export function RegisterTable({
  rows,
  canRecalculate,
}: {
  rows: RegisterRow[];
  canRecalculate: boolean;
}) {
  const [state, action] = useActionState(bulkRecalculateAction, {});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  if (!rows.length) {
    // Keep the result of a bulk recalculation visible even when it empties the filtered list.
    return (
      <div className="space-y-3">
        <FormMessage state={state} />
        <p className="rounded border border-gray-200 bg-white p-6 text-sm text-gray-600">
          No submissions match.
        </p>
      </div>
    );
  }

  return (
    <form action={action}>
      <div className="overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-brand-50 text-brand-900 text-xs">
            <tr>
              {canRecalculate && (
                <th className="px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOnPage}
                    onChange={() =>
                      setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))
                    }
                  />
                </th>
              )}
              <th className="px-2 py-2">Ack No.</th>
              <th className="px-2 py-2">Registered name</th>
              <th className="px-2 py-2">Cat.</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Submitted</th>
              <th className="px-2 py-2 text-right">Total due</th>
              <th className="px-2 py-2 text-right">Balance</th>
              <th className="px-2 py-2">Payment</th>
              <th className="px-2 py-2">SLA</th>
              <th className="px-2 py-2">Flags</th>
              <th className="px-2 py-2">Next action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.id} className="align-top hover:bg-gray-50">
                {canRecalculate && (
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      name="ids"
                      value={r.id}
                      aria-label={`Select ${r.ackNo}`}
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                )}
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <Link
                    href={`/submissions/${r.id}`}
                    className="text-brand-700 font-medium hover:underline"
                  >
                    {r.ackNo}
                  </Link>
                </td>
                <td className="px-2 py-1.5">{r.registeredName}</td>
                <td className="px-2 py-1.5">{r.category ?? "—"}</td>
                <td className="px-2 py-1.5">
                  <StatusBadge status={r.status} />
                  <span className="block text-xs text-gray-500">Stage {r.stage}</span>
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">{showDate(r.dateSubmitted)}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  {showMoney(r.totalDue)}
                </td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">{showMoney(r.balance)}</td>
                <td className="px-2 py-1.5">
                  <PaymentBadge status={r.paymentStatus} />
                </td>
                <td className="px-2 py-1.5">
                  <SlaBadge sla={r.sla} />
                </td>
                <td className="px-2 py-1.5" title={r.flags.map((f) => f.message).join("\n")}>
                  {r.flags.length ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                      {r.flags.length}
                    </span>
                  ) : (
                    <span className="text-gray-400">0</span>
                  )}
                </td>
                <td className="max-w-64 px-2 py-1.5 text-xs text-gray-700">{r.nextAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canRecalculate && (
        <fieldset className="mt-4 max-w-3xl rounded border border-gray-200 bg-white p-3">
          <legend className="text-brand-800 px-1 text-sm font-semibold">
            Recalculate pricing for ticked submissions ({selected.size})
          </legend>
          <p className="mb-2 text-xs text-gray-600">
            Re-prices under the current fee table and Settings. Each changed submission gets its own
            audit entry with this reason. Registered submissions are skipped.
          </p>
          <FormMessage state={state} />
          <div className="mt-2 flex items-end gap-3">
            <div className="flex-1">
              <Field label="Reason" name="reason" errors={state.fieldErrors}>
                <input
                  id="reason"
                  name="reason"
                  className={inputClass}
                  defaultValue={String(state.values?.reason ?? "")}
                />
              </Field>
            </div>
            <SubmitButton pendingText="Recalculating…">Recalculate</SubmitButton>
          </div>
        </fieldset>
      )}
    </form>
  );
}
