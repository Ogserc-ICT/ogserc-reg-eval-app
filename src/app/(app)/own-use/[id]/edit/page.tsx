import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { loadFormOptions } from "@/server/options";
import { loadSettings, toIsoDate } from "@/server/reference-data";
import { updateOwnUseAction } from "../../actions";
import { OwnUseForm } from "../../own-use-form";

export default async function EditOwnUsePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("ownUse.create");
  const { id } = await params;
  const [row, options, settings] = await Promise.all([
    db.ownUseNotification.findUnique({ where: { id } }),
    loadFormOptions(db),
    loadSettings(db),
  ]);
  if (!row) notFound();
  const s = (v: string | null) => v ?? "";
  const initial = {
    name: row.name,
    dateFiled: toIsoDate(row.dateFiled),
    cacNo: s(row.cacNo),
    siteAddress: s(row.siteAddress),
    lga: row.lga,
    natureOfBusiness: s(row.natureOfBusiness),
    gridConnected: row.gridConnected === null ? "" : row.gridConnected ? "Y" : "N",
    distributionLicensee: s(row.distributionLicensee),
    units: row.units?.toString() ?? "",
    installedCapacityKw: row.installedCapacityKw.toString(),
    fuel: s(row.fuel),
    avgMonthlyOutputMwh: row.avgMonthlyOutputMwh?.toString() ?? "",
    contactPerson: s(row.contactPerson),
    phone: s(row.phone),
    email: s(row.email),
  };
  return (
    <div>
      <PageHeader title={`Edit ${row.ounNo}`} back={{ href: `/own-use/${id}`, label: row.name }} />
      <p className="mb-4 max-w-3xl text-sm text-gray-600">
        Changes are audited. The saved fee is not changed here; an admin recalculates if a change
        affects it.
      </p>
      <OwnUseForm
        mode="edit"
        action={updateOwnUseAction.bind(null, id)}
        options={options}
        thresholdKw={settings.ownUseThresholdKw}
        initial={initial}
      />
    </div>
  );
}
