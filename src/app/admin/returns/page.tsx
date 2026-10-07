import type { Metadata } from "next";
import { RotateCcw } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { ROUTES } from "@/config/routes";
import { ReturnCard } from "@/features/returns/components/return-card";
import { parseReturnFilter, ReturnStatusFilter } from "@/features/returns/components/return-status-filter";
import { listReturns } from "@/features/returns/queries";
import { requireRole } from "@/lib/auth/dal";
import { paymentsOn } from "@/lib/payments/status";

export const metadata: Metadata = { title: "Returns" };

export default async function AdminReturnsPage({ searchParams }: PageProps<"/admin/returns">) {
  await requireRole(["admin", "super_admin"], ROUTES.admin.returns);
  const { status: rawStatus } = await searchParams;
  const status = parseReturnFilter(rawStatus, "received");
  const returns = await listReturns({ status });
  const canRefund = paymentsOn();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Operations"
        title="Returns"
        description="Return requests across all vendors. Vendors approve and receive returns; refund received returns here. Refunds go through Stripe (test mode) and follow the shipping and liability policies."
      />
      <ReturnStatusFilter basePath={ROUTES.admin.returns} active={status} />
      {returns.length ? (
        <div className="grid gap-4">
          {returns.map((ret) => (
            <ReturnCard key={ret.id} ret={ret} viewer="admin" canManage canRefund={canRefund} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<RotateCcw />} title="No returns here" description="Nothing in this state right now." />
      )}
    </div>
  );
}
