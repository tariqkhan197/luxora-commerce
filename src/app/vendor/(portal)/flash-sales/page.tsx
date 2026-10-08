import type { Metadata } from "next";
import { Zap } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { STORE_CURRENCY } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { FlashSaleFormDialog } from "@/features/promotions/components/flash-sale-form-dialog";
import { FlashSaleList } from "@/features/promotions/components/flash-sale-list";
import { listFlashSales, listVendorVariantOptions } from "@/features/promotions/queries";
import { requireVendorContext } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Flash sales" };

export default async function VendorFlashSalesPage() {
  const { vendor, memberRole } = await requireVendorContext(ROUTES.vendor.flashSales);
  const canManage = memberRole === "owner" || memberRole === "manager";
  const [sales, variants] = await Promise.all([
    listFlashSales({ vendorId: vendor.id }),
    canManage ? listVendorVariantOptions(vendor.id) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Vendor portal"
        title="Flash sales"
        description="Time-limited sale prices on your products, paid for by your store (commission is charged on the sale price). Sale prices must be below the regular price; discount codes don't apply to sale items. Units sold at the sale price are not returned to the sale after a refund or return."
        actions={canManage ? <FlashSaleFormDialog currency={STORE_CURRENCY} variants={variants} /> : null}
      />
      {!canManage ? (
        <Alert variant="info">
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>Only owners and managers can create or change flash sales.</AlertDescription>
        </Alert>
      ) : null}
      {sales.length ? (
        <FlashSaleList sales={sales} viewer="vendor" canManage={canManage} variants={variants} />
      ) : (
        <EmptyState
          icon={<Zap />}
          title="No flash sales yet"
          description="Create a sale to reduce prices for a set time."
        />
      )}
    </div>
  );
}
