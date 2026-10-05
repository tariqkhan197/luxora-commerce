import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";

export const metadata: Metadata = { title: "Access denied" };

export default function ForbiddenPage() {
  return (
    <div className="container-editorial flex min-h-[60vh] flex-col items-start justify-center py-16">
      <p className="mb-4 eyebrow">403</p>
      <h1 className="display-2">You don&apos;t have access to this area.</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-soft">
        Your account doesn&apos;t have the role required for this page. If you believe this is a mistake, contact
        support.
      </p>
      <div className="mt-8 flex gap-3">
        <Button asChild>
          <Link href={ROUTES.account.root}>Go to your account</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={ROUTES.home}>Back to storefront</Link>
        </Button>
      </div>
    </div>
  );
}
