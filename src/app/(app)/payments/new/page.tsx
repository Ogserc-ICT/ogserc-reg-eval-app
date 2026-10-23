import { PageHeader } from "@/components/page-header";
import { appToday } from "@/server/clock";
import { db } from "@/lib/db";
import { safeInternalPath } from "@/lib/paths";
import { requirePermission } from "@/lib/session";
import { loadFormOptions } from "@/server/options";
import { PaymentForm } from "./payment-form";

export default async function NewPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string; returnTo?: string }>;
}) {
  await requirePermission("payment.record");
  const [{ reference, returnTo }, options] = await Promise.all([searchParams, loadFormOptions(db)]);
  const back = safeInternalPath(returnTo, "/payments");
  return (
    <div>
      <PageHeader title="Record payment" back={{ href: back, label: "Back" }} />
      <PaymentForm
        options={options}
        returnTo={back}
        initial={{
          dateReceived: appToday(),
          reference: reference ?? "",
          purpose: "",
          channel: "",
          amount: "",
          rrr: "",
        }}
      />
    </div>
  );
}
