import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { inputClass } from "@/components/form";
import { can } from "@/domain/roles";
import { FILING_LABELS, STATUSES } from "@/domain/types";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { loadFormOptions } from "@/server/options";
import { listRegister, registerFiltersFrom } from "@/server/register";
import { RegisterTable } from "./register-table";

const PAGE_SIZE = 50;
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("records.read");
  const sp = await searchParams;
  const filters = registerFiltersFrom((k) => one(sp[k]));
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [rows, options] = await Promise.all([listRegister(db, filters), loadFormOptions(db)]);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  const select = (
    name: string,
    label: string,
    choices: string[] | { value: string; label: string }[],
  ) => (
    <label className="text-xs text-gray-600">
      {label}
      <select name={name} defaultValue={one(sp[name])} className={`${inputClass} mt-0.5`}>
        <option value="">All</option>
        {choices.map((c) =>
          typeof c === "string" ? (
            <option key={c}>{c}</option>
          ) : (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ),
        )}
      </select>
    </label>
  );
  const toggle = (name: string, label: string) => (
    <label className="flex items-center gap-1.5 text-xs text-gray-700">
      <input type="checkbox" name={name} value="1" defaultChecked={one(sp[name]) === "1"} />
      {label}
    </label>
  );
  const exportLink = (format: "csv" | "xlsx") => {
    const params = new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) => (v && k !== "page" ? [[k, one(v)]] : [])),
    );
    params.set("format", format);
    return `/submissions/export?${params}`;
  };
  const pageLink = (p: number) => {
    const params = new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) => (v && k !== "page" ? [[k, one(v)]] : [])),
    );
    params.set("page", String(p));
    return `/submissions?${params}`;
  };

  return (
    <div>
      <PageHeader title="Register">
        <span className="flex gap-2">
          <a
            href={exportLink("xlsx")}
            className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            Export Excel
          </a>
          <a
            href={exportLink("csv")}
            className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            Export CSV
          </a>
          {can(user.roles, "submission.create") && (
            <Link
              href="/submissions/new"
              className="bg-brand-700 hover:bg-brand-800 rounded px-3 py-2 text-sm font-medium text-white"
            >
              New submission
            </Link>
          )}
        </span>
      </PageHeader>

      <form method="get" className="mb-4 rounded border border-gray-200 bg-white p-3" role="search">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <label className="col-span-2 text-xs text-gray-600">
            Search
            <input
              name="q"
              defaultValue={filters.q}
              placeholder="Name, Ack No., CAC, TIN or Reg. No."
              className={`${inputClass} mt-0.5`}
            />
          </label>
          {select("status", "Status", [...STATUSES])}
          {select(
            "category",
            "Category",
            options.categories.map((c) => c.category),
          )}
          {select(
            "activity",
            "Activity",
            options.activities.map((a) => ({ value: a.code, label: a.code })),
          )}
          {select(
            "filing",
            "Filing",
            Object.entries(FILING_LABELS).map(([value, label]) => ({ value, label })),
          )}
          {select(
            "form",
            "Form",
            options.forms.map((f) => f.form),
          )}
          {select("lga", "LGA", options.lgas)}
          {select("payment", "Payment", ["Unpaid", "Part-paid", "Paid", "Nil"])}
          {select("sla", "SLA", ["Red", "Amber", "Green"])}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {toggle("flagged", "With data flags")}
          {toggle("late", "Late submissions")}
          {toggle("stale", "Pricing out of date")}
          {toggle("overpaid", "Overpaid / credits")}
          {toggle("closedUnpaid", "Unpaid on closed")}
          <button
            type="submit"
            className="bg-brand-700 hover:bg-brand-800 ml-auto rounded px-3 py-1.5 text-sm text-white"
          >
            Apply
          </button>
          <Link href="/submissions" className="text-brand-700 text-sm hover:underline">
            Clear
          </Link>
        </div>
      </form>

      <p className="mb-2 text-sm text-gray-600">
        {rows.length} submission{rows.length === 1 ? "" : "s"}
        {pages > 1 && ` · page ${page} of ${pages}`}
      </p>
      <RegisterTable rows={pageRows} canRecalculate={can(user.roles, "pricing.recalculate")} />

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-3 flex gap-2 text-sm">
          {page > 1 && (
            <Link href={pageLink(page - 1)} className="text-brand-700 hover:underline">
              ← Previous
            </Link>
          )}
          {page < pages && (
            <Link href={pageLink(page + 1)} className="text-brand-700 hover:underline">
              Next →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
