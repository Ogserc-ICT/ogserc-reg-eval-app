import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { IDLE_SIGN_OUT_SECONDS } from "@/lib/session-timeout";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  if (await getCurrentUser()) redirect("/");
  const { reason } = await searchParams;
  return (
    <main className="bg-brand-800 flex min-h-screen items-center justify-center p-4">
      <div className="border-gold-500 w-full max-w-sm rounded-lg border-t-4 bg-white p-6 shadow-lg">
        <Image
          src="/ogserc-logo.png"
          alt="OGSERC"
          width={180}
          height={40}
          priority
          className="mx-auto"
          style={{ height: "auto" }}
        />
        <h1 className="text-brand-800 mt-4 text-center text-lg font-semibold">
          Registration &amp; Evaluation System
        </h1>
        <p className="mb-5 text-center text-xs text-gray-500">Staff sign-in</p>
        {reason === "idle" && (
          <p
            role="status"
            className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          >
            You were signed out after {IDLE_SIGN_OUT_SECONDS / 60} minutes of inactivity. Please
            sign in again.
          </p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
