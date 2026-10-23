import Link from "next/link";

export function PageHeader({
  title,
  back,
  children,
}: {
  title: string;
  back?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-5">
      {back && (
        <Link href={back.href} className="text-brand-700 text-sm hover:underline">
          ← {back.label}
        </Link>
      )}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-brand-800 text-2xl font-semibold">{title}</h1>
        {children}
      </div>
    </header>
  );
}
