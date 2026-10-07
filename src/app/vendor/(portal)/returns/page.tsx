import type { Metadata } from "next";
import { RotateCcw } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RETURN_WINDOW_DAYS } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { ReturnCard } from "@/features/returns/components/return-card";
import { parseReturnFilter, ReturnStatusFilter } from "@/features/returns/components/return-status-filter";
import { listReturns } from "@/features/returns/queries";
import { requireVendorContext } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Returns" };

export default async function VendorReturnsPage({ searchParams }: PageProps<"/vendor/returns">) {
  const { vendor, memberRole } = await requireVendorContext(ROUTES.vendor.returns);
  const { status: rawStatus } = await searchParams;
  const status = parseReturnFilter(rawStatus, "requested");
  const returns = await listReturns({ vendorId: vendor.id, status });
  const canManage = memberRole === "owner" || memberRole === "manager";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Vendor portal"
        title="Returns"
        description={`Customers can return items within ${RETURN_WINDOW_DAYS} days of delivery. Approve a request with your return address, then mark the parcel received; Luxora issues the refund.`}
      />
      {!canManage ? (
        <Alert variant="info">
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>Only owners and managers can approve, decline or receive returns.</AlertDescription>
        </Alert>
      ) : null}
      <ReturnStatusFilter basePath={ROUTES.vendor.returns} active={status} />
      {returns.length ? (
        <div className="grid gap-4">
          {returns.map((ret) => (
            <ReturnCard key={ret.id} ret={ret} viewer="vendor" canManage={canManage} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<RotateCcw />}
          title="No returns here"
          description="Return requests from your customers appear here."
        />
      )}
    </div>
  );
}
