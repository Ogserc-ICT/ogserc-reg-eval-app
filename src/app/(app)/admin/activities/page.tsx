import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { OWN_USE_CATEGORY } from "@/domain/reference-admin";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { loadReferenceData, loadSettings } from "@/server/reference-data";
import { updateActivityMapAction } from "../actions";
import { ActivityMapForm } from "./activity-map-form";

export default async function ActivityMapPage() {
  await requirePermission("admin.referenceData");
  const [{ activities, fees }, settings] = await Promise.all([
    loadReferenceData(db),
    loadSettings(db),
  ]);
  return (
    <div className="max-w-6xl">
      <PageHeader title="Activity → category map" back={{ href: "/admin", label: "Admin" }} />
      <div className="mb-4 max-w-3xl space-y-1 text-sm text-gray-700">
        <p>
          The category for an activity at its installed capacity (SPEC §2.2); with several
          activities the highest applies (para 17(1)). Activity names and codes are fixed: codes are
          part of registration numbers.
        </p>
        <p>
          Supply / retail (SUP) at 1 MW or more takes the category set in{" "}
          <Link href="/admin/settings" className="text-brand-700 underline">
            Settings
          </Link>{" "}
          (Category {settings.policy.supplyRetailCategory1MwPlus}), not its columns here.
        </p>
        <p>
          Saved submissions keep their category; any whose category would now differ show
          &ldquo;pricing out of date&rdquo; until an admin recalculates them.
        </p>
      </div>
      <ActivityMapForm
        activities={activities}
        categories={fees.map((f) => f.category).filter((c) => c !== OWN_USE_CATEGORY)}
        action={updateActivityMapAction}
      />
    </div>
  );
}
