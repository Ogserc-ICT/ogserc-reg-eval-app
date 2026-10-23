import Link from "next/link";
import { PageHeader } from "@/components/page-header";

export default function ForbiddenPage() {
  return (
    <div>
      <PageHeader title="Not allowed" />
      <p className="text-sm text-gray-700">
        Your roles do not include access to that page. Ask an administrator if you need it.
      </p>
      <Link href="/" className="text-brand-700 mt-3 inline-block text-sm hover:underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
