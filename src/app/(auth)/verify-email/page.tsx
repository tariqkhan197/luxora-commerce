import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { ROUTES } from "@/config/routes";
import { ResendVerificationButton } from "@/features/auth/components/resend-verification-button";
import { emailSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Verify your email" };

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const params = await searchParams;
  const parsed = emailSchema.safeParse(typeof params.email === "string" ? params.email : "");
  const email = parsed.success ? parsed.data : null;

  return (
    <div className="w-full max-w-md">
      <MailCheck className="size-8 text-accent" aria-hidden />
      <h1 className="mt-6 display-2">Check your inbox</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        {email ? (
          <>
            We sent a verification link to <span className="font-medium text-ink">{email}</span>.
          </>
        ) : (
          "We sent a verification link to your email address."
        )}{" "}
        Open it to activate your account.
      </p>
      <div className="mt-8 flex flex-col gap-6">
        {email ? <ResendVerificationButton email={email} /> : null}
        <p className="text-sm text-ink-soft">
          Already verified?{" "}
          <Link href={ROUTES.auth.login} className="font-medium text-ink underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
