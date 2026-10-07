import type { Metadata } from "next";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { RETURN_WINDOW_DAYS } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { ReturnCard } from "@/features/returns/components/return-card";
import { listReturns } from "@/features/returns/queries";
import { requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Returns" };

export default async function AccountReturnsPage() {
  const { profile } = await requireUser(ROUTES.account.returns);
  // RLS already limits customers to their own returns; the filter keeps admins on their own account view.
  const own = await listReturns({ customerId: profile.id });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Account"
        title="Returns"
        description={`You can return items within ${RETURN_WINDOW_DAYS} days of delivery. Start a return from the order page.`}
      />
      {own.length ? (
        <div className="grid gap-4">
          {own.map((ret) => (
            <ReturnCard key={ret.id} ret={ret} viewer="customer" />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<RotateCcw />}
          title="No returns"
          description="When you return an item, you can follow it here."
          action={
            <Button asChild variant="outline">
              <Link href={ROUTES.account.orders}>View your orders</Link>
            </Button>
          }
        />
      )}
      <p className="text-xs text-ink-faint">
        See the{" "}
        <Link href={ROUTES.legal.returns} className="underline underline-offset-4">
          Returns Policy
        </Link>
        .
      </p>
    </div>
  );
}
