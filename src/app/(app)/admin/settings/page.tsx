import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { loadSettings } from "@/server/reference-data";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  await requirePermission("admin.settings");
  const settings = await loadSettings(db);
  return (
    <div>
      <PageHeader title="Settings" back={{ href: "/admin", label: "Admin" }} />
      <SettingsForm settings={settings} />
    </div>
  );
}
