import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";

export const metadata: Metadata = { title: "Authentication problem" };

const REASONS: Record<string, { title: string; body: string }> = {
  invalid_link: {
    title: "This link isn't valid",
    body: "The link may have been used already or was copied incompletely.",
  },
  expired_link: {
    title: "This link has expired",
    body: "For your security, links are only valid for a short time. Request a new one.",
  },
  exchange_failed: {
    title: "We couldn't complete sign-in",
    body: "The sign-in provider returned an error. Please try again.",
  },
  account_suspended: {
    title: "Account suspended",
    body: "Your account has been suspended. Contact support if you believe this is a mistake.",
  },
  account_deactivated: { title: "Account deactivated", body: "This account is no longer active." },
};

export default async function AuthErrorPage({ searchParams }: PageProps<"/auth/error">) {
  const params = await searchParams;
  const reason = typeof params.reason === "string" ? params.reason : "";
  const content = REASONS[reason] ?? { title: "Something went wrong", body: "We couldn't complete that request." };

  return (
    <div className="w-full max-w-md">
      <h1 className="display-2">{content.title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{content.body}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild>
          <Link href={ROUTES.auth.login}>Go to sign in</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={ROUTES.auth.forgotPassword}>Request a new link</Link>
        </Button>
      </div>
    </div>
  );
}
