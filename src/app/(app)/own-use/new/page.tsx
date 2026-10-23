import { PageHeader } from "@/components/page-header";
import { appToday } from "@/server/clock";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { loadFormOptions } from "@/server/options";
import { loadSettings } from "@/server/reference-data";
import { createOwnUseAction } from "../actions";
import { OwnUseForm } from "../own-use-form";

export default async function NewOwnUsePage() {
  await requirePermission("ownUse.create");
  const [options, settings] = await Promise.all([loadFormOptions(db), loadSettings(db)]);
  return (
    <div>
      <PageHeader
        title="New own-use notification (OUN-01)"
        back={{ href: "/own-use", label: "Own-use notifications" }}
      />
      <OwnUseForm
        mode="create"
        action={createOwnUseAction}
        options={options}
        thresholdKw={settings.ownUseThresholdKw}
        initial={{ dateFiled: appToday() }}
      />
    </div>
  );
}
