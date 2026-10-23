import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { BarChart } from "@/components/viz/bar-chart";
import { ChartCard, DataTable } from "@/components/viz/chart-card";
import { ColumnChart } from "@/components/viz/column-chart";
import { formatValue } from "@/components/viz/format";
import { Meter, StatTile } from "@/components/viz/stat-tile";
import type { QueueItem } from "@/domain/dashboard";
import { formatDate } from "@/domain/dates";
import { formatNaira } from "@/domain/money";
import { can } from "@/domain/roles";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { getDashboard } from "@/server/dashboard";
import { lastDailyReview } from "@/server/daily-review";
import { runDailyReviewAction } from "./actions";
import { DailyReviewForm } from "./daily-review-form";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const SERIES_1 = "var(--viz-series-1)";
const SERIES_2 = "var(--viz-series-2)";
const count = (n: number) => n.toLocaleString("en-NG");

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-sm font-semibold tracking-wide text-gray-600 uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Queue({
  title,
  items,
  empty,
  detail,
  href = (item) => `/submissions/${item.id}/evaluation`,
}: {
  title: string;
  items: QueueItem[];
  empty: string;
  detail: (item: QueueItem) => string;
  /** Where each item leads (default: its evaluation). */
  href?: (item: QueueItem) => string;
}) {
  return (
    <section aria-label={title} className="min-w-0 rounded border border-gray-200 bg-white">
      <h2 className="text-brand-800 flex items-center justify-between border-b border-gray-100 px-3 py-2 text-sm font-semibold">
        {title}
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">
          {items.length}
        </span>
      </h2>
      {items.length ? (
        <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id} className="px-3 py-2 text-sm">
              <Link href={href(item)} className="text-brand-700 font-medium hover:underline">
                {item.name}
              </Link>
              <span className="block text-xs text-gray-500">
                {item.ackNo} · {detail(item)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-4 text-sm text-gray-500">{empty}</p>
      )}
    </section>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const user = await requirePermission("dashboard.read");
  const requested = Number((await searchParams).year);
  const {
    dashboard: d,
    queues,
    today,
  } = await getDashboard(db, user, {
    monthYear: Number.isInteger(requested) ? requested : null,
  });
  const lastReview = await lastDailyReview(db);
  const year = d.monthWindow.year;
  const days = d.keyDates.daysToDeadline;
  const windowText =
    d.monthWindow.mode === "year"
      ? `January to December ${year}`
      : d.monthWindow.mode === "rolling"
        ? "The last 12 months"
        : "12 months from the Effective Date's month";

  const monthly = d.monthly.map((m, i) => {
    const [y, mm] = m.month.split("-").map(Number) as [number, number];
    return {
      key: m.month,
      label: i === 0 || mm === 1 ? `${MONTHS[mm - 1]} ’${String(y).slice(2)}` : MONTHS[mm - 1]!,
      title: `${FULL_MONTHS[mm - 1]} ${y}`,
      m,
    };
  });
  const activities = d.byActivity.filter((a) => a.count > 0);
  const lgas = [...d.byLga]
    .filter((l) => l.registrants + l.ownUse > 0)
    .sort((a, b) => b.registrants + b.ownUse - (a.registrants + a.ownUse));
  const totals = d.byCategory.reduce(
    (t, r) => ({
      submissions: t.submissions + r.submissions,
      registered: t.registered + (r.registered ?? 0),
      fees: t.fees + r.fees,
      lateCharges: t.lateCharges + r.lateCharges,
      waivers: t.waivers + r.waivers,
      collected: t.collected + r.collected,
      outstanding: t.outstanding + r.outstanding,
    }),
    {
      submissions: 0,
      registered: 0,
      fees: 0,
      lateCharges: 0,
      waivers: 0,
      collected: 0,
      outstanding: 0,
    },
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard">
        <span className="text-sm text-gray-500">As at {formatDate(today)}</span>
      </PageHeader>

      <section
        aria-label="Daily review"
        className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-200 bg-white px-3 py-2"
      >
        <div className="text-sm">
          <h2 className="text-brand-800 font-semibold">Daily review</h2>
          <p className="text-gray-600">
            {lastReview ? (
              <>
                Last run{" "}
                {lastReview.timestamp.toLocaleString("en-NG", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Africa/Lagos",
                })}
                {lastReview.user ? ` by ${lastReview.user.name}` : " (scheduled)"}.{" "}
                <span className="text-gray-500">
                  {lastReview.detail?.slice(lastReview.detail.indexOf("Provisional today"))}
                </span>
              </>
            ) : (
              "Not run yet. It runs every day at 06:00."
            )}
          </p>
        </div>
        {can(user.roles, "dailyReview.run") && <DailyReviewForm action={runDailyReviewAction} />}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Queue
          title="My assigned evaluations"
          items={queues.mine}
          empty="Nothing assigned to you."
          detail={(i) => `${i.roles.join(", ")} · ${i.evaluationStatus}`}
        />
        <Queue
          title="Deficiency responses overdue (awaiting lapse)"
          items={queues.overdueDeficiency}
          empty="No overdue responses."
          detail={(i) =>
            `${i.daysOverdue} day${i.daysOverdue === 1 ? "" : "s"} past the response date`
          }
        />
        <Queue
          title="Ready for decision"
          items={queues.readyForDecision}
          empty="Nothing ready for decision."
          detail={(i) =>
            i.determinationDue ? `Determine by ${formatDate(i.determinationDue)}` : i.status
          }
        />
      </div>

      <Queue
        title="Awaiting payment, oldest first"
        items={queues.awaitingPayment}
        empty="No submissions are waiting for payment."
        href={(i) => `/submissions/${i.id}`}
        detail={(i) =>
          `${i.daysWaiting} day${i.daysWaiting === 1 ? "" : "s"} since acknowledgement · ${i.stage}` +
          (i.reminderDue ? " · Reminder due" : "")
        }
      />

      <Section title="Key dates">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Effective Date"
            value={formatDate(d.keyDates.effectiveDate)}
            href="/admin/settings"
          />
          <StatTile
            label="Registration deadline (existing operators)"
            value={formatDate(d.keyDates.registrationDeadline)}
          />
          <StatTile
            label="Days to deadline"
            value={days >= 0 ? count(days) : "Passed"}
            hint={days >= 0 ? undefined : `${count(-days)} days ago`}
          />
        </div>
      </Section>

      <Section title="Submissions">
        <div className="grid gap-3 sm:grid-cols-4 xl:grid-cols-8">
          <StatTile label="Total" value={count(d.submissions.total)} href="/submissions" />
          <StatTile
            label="Awaiting payment"
            value={count(d.submissions.awaitingPayment)}
            hint="Acknowledged; waiting for Finance to confirm payment"
            href={`/submissions?status=${encodeURIComponent("Acknowledged - Awaiting Payment")}`}
          />
          <StatTile
            label="Registered"
            value={count(d.submissions.registered)}
            href="/submissions?status=Registered"
          />
          <StatTile
            label="Provisionally registered"
            value={count(d.submissions.provisional)}
            href={`/submissions?status=${encodeURIComponent("Provisionally Registered")}`}
          />
          <StatTile
            label="In progress"
            value={count(d.submissions.inProgress)}
            hint="Under review or deficiency"
          />
          <StatTile
            label="Closed"
            value={count(d.submissions.closed)}
            hint="Refused, lapsed or cancelled"
          />
          <StatTile
            label="Own-use notifications"
            value={count(d.submissions.ownUse)}
            href="/own-use"
          />
          <StatTile
            label="Late submissions"
            value={count(d.submissions.late)}
            href="/submissions?late=1"
          />
        </div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Workflow">
          <div className="grid gap-3 sm:grid-cols-4">
            <StatTile
              label="Overdue"
              value={count(d.workflow.red)}
              status={d.workflow.red ? "critical" : undefined}
              href="/submissions?sla=Red"
            />
            <StatTile
              label="Due within warning window"
              value={count(d.workflow.amber)}
              status={d.workflow.amber ? "warning" : undefined}
              href="/submissions?sla=Amber"
            />
            <StatTile
              label="Records with flags"
              value={count(d.workflow.flagged)}
              href="/submissions?flagged=1"
            />
            <StatTile
              label="Average days in queue"
              value={
                d.workflow.averageDaysInQueue === null
                  ? "—"
                  : d.workflow.averageDaysInQueue.toFixed(1)
              }
              hint="Open submissions"
            />
          </div>
        </Section>
        <Section title="Evaluation">
          <div className="grid gap-3 sm:grid-cols-4">
            <StatTile
              label="Not assigned"
              value={count(d.evaluation["Not assigned"])}
              href={`/evaluations?status=${encodeURIComponent("Not assigned")}`}
            />
            <StatTile
              label="In progress"
              value={count(d.evaluation["In progress"])}
              href={`/evaluations?status=${encodeURIComponent("In progress")}`}
            />
            <StatTile
              label="Ready for decision"
              value={count(d.evaluation["Ready for decision"])}
              href={`/evaluations?status=${encodeURIComponent("Ready for decision")}`}
            />
            <StatTile
              label="Decided"
              value={count(d.evaluation.Decided)}
              href="/evaluations?status=Decided&closed=1"
            />
          </div>
        </Section>
      </div>

      <Section title="Money">
        <div className="grid gap-3 sm:grid-cols-4">
          <StatTile
            label="Total due"
            value={formatNaira(d.money.totalDue)}
            hint="Fees and late charges, incl. own-use; excludes refused, lapsed and cancelled"
          />
          <StatTile
            label="Collected"
            value={formatNaira(d.money.collected)}
            hint="Every payment confirmed by Finance"
            href="/payments?status=ACTIVE&finance=CONFIRMED"
          />
          <StatTile
            label="With Finance"
            value={formatNaira(d.money.withFinance)}
            hint={`${count(d.money.withFinanceCount)} payment(s) recorded, awaiting confirmation; not counted as collected`}
            href={
              can(user.roles, "payment.confirm")
                ? "/finance"
                : "/payments?status=ACTIVE&finance=PENDING"
            }
          />
          <StatTile
            label="Outstanding"
            value={formatNaira(d.money.outstanding)}
            hint="Unpaid on live records"
            href="/submissions?payment=Unpaid"
          />
          <Meter
            label="Collection rate"
            fraction={d.money.collectionRate}
            display={
              d.money.collectionRate === null ? "—" : `${Math.round(d.money.collectionRate * 100)}%`
            }
          />
          <StatTile
            label="Unpaid on closed submissions"
            value={formatNaira(d.money.unpaidOnClosed)}
            hint="Refused, lapsed or cancelled; not in total due"
            href="/submissions?closedUnpaid=1"
          />
          <StatTile
            label="Overpaid / credits"
            value={formatNaira(d.money.overpaid)}
            hint={`${count(d.money.overpaidSubmissions)} submission(s), ${count(d.money.overpaidOwnUse)} own-use`}
            href="/submissions?overpaid=1"
          />
        </div>
        {d.money.overpaidOwnUse > 0 && (
          <p className="text-xs text-gray-500">
            Own-use credits:{" "}
            <Link href="/own-use?overpaid=1" className="text-brand-700 hover:underline">
              see the own-use list
            </Link>
            .
          </p>
        )}
      </Section>

      <form
        method="get"
        className="flex items-center gap-2 text-sm"
        aria-label="Monthly charts period"
      >
        <label htmlFor="year" className="text-gray-700">
          Monthly charts
        </label>
        <select
          id="year"
          name="year"
          defaultValue={year ?? ""}
          className="rounded border border-gray-300 bg-white px-2 py-1"
        >
          <option value="">
            {d.monthWindow.mode === "rolling" ? "Last 12 months" : "From the Effective Date"}
          </option>
          {d.monthWindow.years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="bg-brand-700 hover:bg-brand-800 rounded px-3 py-1 text-white"
        >
          Show
        </button>
      </form>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Monthly intake"
          caption={`Submissions by date submitted; registrations by certificate date. ${windowText}.`}
          table={
            <DataTable
              head={["Month", "Submissions", "Registered"]}
              rows={monthly.map(({ title, m }) => [title, m.submissions, m.registered])}
            />
          }
        >
          <ColumnChart
            format="count"
            series={[
              { name: "Submissions", colour: SERIES_1 },
              { name: "Registered", colour: SERIES_2 },
            ]}
            points={monthly.map(({ key, label, title, m }) => ({
              key,
              label,
              title,
              values: [m.submissions, m.registered],
            }))}
          />
        </ChartCard>
        <ChartCard
          title="Collected by month"
          caption={`Active payments by date received (submissions and own-use). ${windowText}.`}
          table={
            <DataTable
              head={["Month", "Collected"]}
              rows={monthly.map(({ title, m }) => [title, formatNaira(m.collected)])}
            />
          }
        >
          <ColumnChart
            format="naira"
            series={[{ name: "Collected", colour: SERIES_1 }]}
            points={monthly.map(({ key, label, title, m }) => ({
              key,
              label,
              title,
              values: [m.collected],
            }))}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          title="Submissions by status"
          table={
            <DataTable
              head={["Status", "Submissions"]}
              rows={d.byStatus.map((s) => [s.status, s.count])}
            />
          }
        >
          <BarChart
            format="count"
            series={[{ name: "Submissions", colour: SERIES_1 }]}
            rows={d.byStatus.map((s) => ({ key: s.status, label: s.status, values: [s.count] }))}
          />
        </ChartCard>
        <ChartCard
          title="Submissions by primary activity"
          caption={
            activities.length < d.byActivity.length
              ? "Activities with no submissions are in the table."
              : undefined
          }
          table={
            <DataTable
              head={["Activity", "Code", "Submissions"]}
              rows={d.byActivity.map((a) => [a.name, a.code, a.count])}
            />
          }
        >
          {activities.length ? (
            <BarChart
              format="count"
              labelWidth="5rem"
              series={[{ name: "Submissions", colour: SERIES_1 }]}
              rows={activities.map((a) => ({ key: a.code, label: a.code, values: [a.count] }))}
            />
          ) : (
            <p className="text-sm text-gray-500">No submissions yet.</p>
          )}
        </ChartCard>
        <ChartCard
          title="By principal LGA"
          caption="Registrants and own-use notifications. LGAs with none are in the table."
          table={
            <DataTable
              head={["LGA", "Registrants", "Own-use"]}
              rows={d.byLga.map((l) => [l.lga, l.registrants, l.ownUse])}
            />
          }
        >
          {lgas.length ? (
            <BarChart
              format="count"
              labelWidth="8rem"
              series={[
                { name: "Registrants", colour: SERIES_1 },
                { name: "Own-use", colour: SERIES_2 },
              ]}
              rows={lgas.map((l) => ({
                key: l.lga,
                label: l.lga,
                values: [l.registrants, l.ownUse],
              }))}
            />
          ) : (
            <p className="text-sm text-gray-500">No records yet.</p>
          )}
        </ChartCard>
      </div>

      <section
        aria-label="By Schedule 3 category"
        className="rounded border border-gray-200 bg-white p-4"
      >
        <h2 className="text-brand-800 mb-1 text-sm font-semibold">By Schedule 3 category</h2>
        <p className="mb-3 text-xs text-gray-500">Category I comes from own-use notifications.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-gray-500">
              <tr>
                <th className="py-1 pr-3 font-normal">Category</th>
                {[
                  "Submissions",
                  "Registered",
                  "Fees",
                  "Late charges",
                  "Waivers",
                  "Collected",
                  "Outstanding",
                ].map((h) => (
                  <th key={h} className="py-1 pr-3 text-right font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 tabular-nums">
              {d.byCategory.map((r) => (
                <tr key={r.category} className={r.submissions ? "" : "text-gray-400"}>
                  <td className="py-1.5 pr-3" title={r.description}>
                    <strong className="font-semibold">{r.category}</strong>{" "}
                    <span className="text-xs text-gray-500">
                      {r.description.slice(0, 60)}
                      {r.description.length > 60 ? "…" : ""}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-right">{count(r.submissions)}</td>
                  <td className="py-1.5 pr-3 text-right">
                    {r.registered === null ? "—" : count(r.registered)}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{formatValue(r.fees, "naira")}</td>
                  <td className="py-1.5 pr-3 text-right">{formatValue(r.lateCharges, "naira")}</td>
                  <td className="py-1.5 pr-3 text-right">{formatValue(r.waivers, "naira")}</td>
                  <td className="py-1.5 pr-3 text-right">{formatValue(r.collected, "naira")}</td>
                  <td className="py-1.5 pr-3 text-right">{formatValue(r.outstanding, "naira")}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-gray-300 font-semibold tabular-nums">
              <tr>
                <td className="py-1.5 pr-3">Total</td>
                <td className="py-1.5 pr-3 text-right">{count(totals.submissions)}</td>
                <td className="py-1.5 pr-3 text-right">{count(totals.registered)}</td>
                <td className="py-1.5 pr-3 text-right">{formatNaira(totals.fees)}</td>
                <td className="py-1.5 pr-3 text-right">{formatNaira(totals.lateCharges)}</td>
                <td className="py-1.5 pr-3 text-right">{formatNaira(totals.waivers)}</td>
                <td className="py-1.5 pr-3 text-right">{formatNaira(totals.collected)}</td>
                <td className="py-1.5 pr-3 text-right">{formatNaira(totals.outstanding)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}
